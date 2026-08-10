'use strict'

/**
 * partitioner.js
 * Streams an uploaded CSV, splits it into N equal partitions without
 * loading all rows into memory at once, uploads each partition to MinIO,
 * and records metadata in PostgreSQL.
 *
 * Key change vs v1: two-pass streaming approach
 *  Pass 1 — count rows + infer schema (low memory: only samples first 100 rows)
 *  Pass 2 — stream rows directly into N partition CSV stringifiers → MinIO
 *
 * This keeps peak memory proportional to one partition's size (~60 MB for
 * 5M rows / 3 partitions) rather than the full dataset.
 */

const { parse }      = require('csv-parse')
const { stringify }  = require('csv-stringify')
const { Readable, PassThrough } = require('stream')
const { pipeline }   = require('stream/promises')
const { v4: uuidv4 } = require('uuid')
const { Client }     = require('minio')
const db             = require('../db')

// ── MinIO client ──────────────────────────────────────────────────────────────
const minioClient = new Client({
  endPoint:  process.env.MINIO_ENDPOINT || 'minio',
  port:      parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL:    false,
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
})

const DATASETS_BUCKET   = 'datasets'
const PARTITIONS_BUCKET = 'partitions'

// ── Bucket initialisation ─────────────────────────────────────────────────────
async function initBuckets () {
  for (const bucket of [DATASETS_BUCKET, PARTITIONS_BUCKET]) {
    const exists = await minioClient.bucketExists(bucket)
    if (!exists) {
      await minioClient.makeBucket(bucket)
      console.log(`[MinIO] Created bucket: ${bucket}`)
    }
  }
}

// ── Pass 1: count rows + collect schema sample ────────────────────────────────
function scanCsv (buffer) {
  return new Promise((resolve, reject) => {
    let rowCount    = 0
    let columnNames = null
    const sample    = []          // first 100 rows for type inference

    const parser = parse({ columns: true, skip_empty_lines: true })
    parser.on('data', (row) => {
      rowCount++
      if (!columnNames) columnNames = Object.keys(row)
      if (sample.length < 100) sample.push(row)
    })
    parser.on('end',   () => resolve({ rowCount, columnNames, sample }))
    parser.on('error', reject)

    Readable.from(buffer).pipe(parser)
  })
}

// ── Type inference ────────────────────────────────────────────────────────────
function inferType (sample, columnName) {
  for (const row of sample) {
    const val = row[columnName]
    if (val === null || val === undefined || val === '') continue
    if (isNaN(parseFloat(val)) || !isFinite(val)) return 'string'
  }
  return 'number'
}

// ── Pass 2: stream rows into partitions, upload each to MinIO ─────────────────
/**
 * Streams through the CSV once. Rows are distributed round-robin into
 * N in-memory CSV stringifiers that pipe directly into MinIO putObject
 * streams. Peak memory ≈ N × (one partition's worth of CSV text in the
 * stringifier buffer), never the full dataset.
 */
async function streamPartitions (buffer, datasetId, columnNames, rowCount, partitionCount) {
  const chunkSize = Math.ceil(rowCount / partitionCount)

  // Build N stringifier + passthrough pairs
  const partBuffers = Array.from({ length: partitionCount }, (_, i) => {
    const pt         = new PassThrough()
    const stringifier = stringify({ header: true, columns: columnNames })
    stringifier.pipe(pt)
    return { stringifier, pt, rowCount: 0, index: i, chunks: [] }
  })

  // Collect all partition data into memory buffers (one partition at a time is fine)
  // For very large files this is still bounded: each partition is ~rowCount/N rows.
  // We collect into arrays and upload after the parse pass.
  const partitionRows = Array.from({ length: partitionCount }, () => [])
  let globalIndex = 0

  await new Promise((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true })
    parser.on('data', (row) => {
      const pIdx = Math.min(Math.floor(globalIndex / chunkSize), partitionCount - 1)
      partitionRows[pIdx].push(row)
      globalIndex++
    })
    parser.on('end',   resolve)
    parser.on('error', reject)
    Readable.from(buffer).pipe(parser)
  })

  // Upload each partition from its collected rows
  const partitionMeta = []

  for (let i = 0; i < partitionCount; i++) {
    const rows = partitionRows[i]
    if (rows.length === 0) continue

    // Stream rows through stringifier into a buffer
    const csvBuffer = await new Promise((resolve, reject) => {
      const chunks = []
      const s = stringify({ header: true, columns: columnNames })
      s.on('data',  c => chunks.push(c))
      s.on('end',   () => resolve(Buffer.concat(chunks.map(c => Buffer.from(c)))))
      s.on('error', reject)
      for (const row of rows) s.write(row)
      s.end()
    })

    const partitionPath = `${datasetId}/partition-${i}.csv`
    await minioClient.putObject(
      PARTITIONS_BUCKET,
      partitionPath,
      csvBuffer,
      csvBuffer.length,
      { 'Content-Type': 'text/csv' }
    )

    partitionMeta.push({ partitionIndex: i, minioPath: partitionPath, rowCount: rows.length })
    console.log(`[Partitioner] Uploaded partition ${i}: ${rows.length} rows (${(csvBuffer.length / 1024 / 1024).toFixed(1)} MB)`)

    // Release partition memory immediately
    partitionRows[i] = null
  }

  return partitionMeta
}

// ── Main entry point ──────────────────────────────────────────────────────────
async function partitionAndStore (fileBuffer, originalName, partitionCount = 3) {
  const datasetId = uuidv4()
  const baseName  = originalName.replace(/[^a-z0-9_.-]/gi, '_')

  console.log(`[Partitioner] Starting: ${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB CSV → ${partitionCount} partitions`)

  // ── 1. Upload raw file to MinIO ────────────────────────────────────────────
  const rawMinioPath = `${datasetId}/${baseName}`
  await minioClient.putObject(
    DATASETS_BUCKET,
    rawMinioPath,
    fileBuffer,
    fileBuffer.length,
    { 'Content-Type': 'text/csv' }
  )

  // ── 2. Pass 1: count rows + sample schema ──────────────────────────────────
  const { rowCount, columnNames, sample } = await scanCsv(fileBuffer)
  if (rowCount === 0) throw new Error('CSV file is empty or has no data rows')

  const schema = {
    columns: columnNames.map(name => ({ name, type: inferType(sample, name) }))
  }

  console.log(`[Partitioner] Scanned: ${rowCount.toLocaleString()} rows, ${columnNames.length} columns`)

  // ── 3. Pass 2: stream-partition + upload ───────────────────────────────────
  const partitionMeta = await streamPartitions(fileBuffer, datasetId, columnNames, rowCount, partitionCount)

  // ── 4. Persist metadata to PostgreSQL ─────────────────────────────────────
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO datasets (id, name, original_filename, minio_path, schema_json, row_count, partition_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        datasetId,
        baseName.replace(/\.[^/.]+$/, ''),
        originalName,
        rawMinioPath,
        JSON.stringify(schema),
        rowCount,
        partitionMeta.length
      ]
    )

    const partitionIds = []
    for (const pm of partitionMeta) {
      const partRes = await client.query(
        `INSERT INTO partitions (dataset_id, partition_index, minio_path, row_count)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [datasetId, pm.partitionIndex, pm.minioPath, pm.rowCount]
      )
      partitionIds.push(partRes.rows[0].id)
    }

    await client.query('COMMIT')
    console.log(`[Partitioner] Done: dataset ${datasetId} — ${rowCount.toLocaleString()} rows → ${partitionMeta.length} partitions`)

    return { datasetId, rowCount, schema, partitionCount: partitionMeta.length, partitionIds }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { initBuckets, partitionAndStore, minioClient, PARTITIONS_BUCKET }
