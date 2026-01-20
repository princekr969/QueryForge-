'use strict'

/**
 * partitioner.js
 * Reads an uploaded CSV, splits it into N equal partitions,
 * uploads each partition to MinIO, and records metadata in PostgreSQL.
 */

const { parse }    = require('csv-parse')
const { stringify } = require('csv-stringify')
const { Readable } = require('stream')
const { v4: uuidv4 } = require('uuid')
const { Client }   = require('minio')
const db           = require('../db')

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

// ── Bucket initialisation — called once on coordinator startup ─────────────────
async function initBuckets () {
  for (const bucket of [DATASETS_BUCKET, PARTITIONS_BUCKET]) {
    const exists = await minioClient.bucketExists(bucket)
    if (!exists) {
      await minioClient.makeBucket(bucket)
      console.log(`[MinIO] Created bucket: ${bucket}`)
    }
  }
}

/**
 * Infer column type by sampling up to 100 rows.
 * A column is 'number' ONLY if ALL sampled non-empty values are valid numbers.
 */
function inferType (rows, columnName) {
  const sampleSize = Math.min(rows.length, 100)
  for (let i = 0; i < sampleSize; i++) {
    const val = rows[i][columnName]
    if (val === null || val === undefined || val === '') continue  // skip empty
    if (isNaN(parseFloat(val)) || !isFinite(val)) return 'string'
  }
  return 'number'
}

/**
 * Parse CSV buffer into an array of row objects, also returning the header schema.
 */
function parseCsvBuffer (buffer) {
  return new Promise((resolve, reject) => {
    const rows = []
    const readable = Readable.from(buffer)
    const parser   = parse({ columns: true, skip_empty_lines: true })

    readable.pipe(parser)
    parser.on('data', (row) => rows.push(row))
    parser.on('end',  () => resolve(rows))
    parser.on('error', reject)
  })
}

/**
 * Serialise an array of row objects back to a CSV string (with header).
 */
function rowsToCsv (rows, columns) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const stringifier = stringify({ header: true, columns })
    stringifier.on('data', (chunk) => chunks.push(chunk))
    stringifier.on('end',  () => resolve(chunks.join('')))
    stringifier.on('error', reject)
    rows.forEach(row => stringifier.write(row))
    stringifier.end()
  })
}

/**
 * Main entry point.
 * Uploads the raw CSV to MinIO, splits into PARTITION_COUNT partitions,
 * uploads each partition, and records everything in PostgreSQL.
 *
 * @param {Buffer} fileBuffer      - raw CSV file content
 * @param {string} originalName    - original filename from the upload
 * @param {number} partitionCount  - number of partitions (default 3)
 * @returns {{ datasetId, rowCount, schema, partitionIds }}
 */
async function partitionAndStore (fileBuffer, originalName, partitionCount = 3) {
  const datasetId  = uuidv4()
  const baseName   = originalName.replace(/[^a-z0-9_.-]/gi, '_')

  // ── 1. Upload raw file to MinIO ─────────────────────────────────────────────
  const rawMinioPath = `${datasetId}/${baseName}`
  await minioClient.putObject(
    DATASETS_BUCKET,
    rawMinioPath,
    fileBuffer,
    fileBuffer.length,
    { 'Content-Type': 'text/csv' }
  )

  // ── 2. Parse CSV into rows ──────────────────────────────────────────────────
  const rows = await parseCsvBuffer(fileBuffer)
  if (rows.length === 0) {
    throw new Error('CSV file is empty or has no data rows')
  }

  const columnNames = Object.keys(rows[0])

  // Build schema with inferred types — sample first 100 rows per column
  const schema = {
    columns: columnNames.map(name => ({
      name,
      type: inferType(rows, name)
    }))
  }

  // ── 3. Split rows into N equal partitions ───────────────────────────────────
  const chunkSize = Math.ceil(rows.length / partitionCount)
  const partitions = []

  for (let i = 0; i < partitionCount; i++) {
    const start = i * chunkSize
    const end   = Math.min(start + chunkSize, rows.length)
    partitions.push(rows.slice(start, end))
  }

  // ── 4. Upload each partition to MinIO ───────────────────────────────────────
  const partitionMeta = []

  for (let i = 0; i < partitions.length; i++) {
    const partitionRows = partitions[i]
    if (partitionRows.length === 0) continue

    const csvContent     = await rowsToCsv(partitionRows, columnNames)
    const partitionPath  = `${datasetId}/partition-${i}.csv`
    const contentBuffer  = Buffer.from(csvContent, 'utf-8')

    await minioClient.putObject(
      PARTITIONS_BUCKET,
      partitionPath,
      contentBuffer,
      contentBuffer.length,
      { 'Content-Type': 'text/csv' }
    )

    partitionMeta.push({
      partitionIndex: i,
      minioPath: partitionPath,
      rowCount: partitionRows.length
    })
  }

  // ── 5. Persist metadata to PostgreSQL ──────────────────────────────────────
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO datasets (id, name, original_filename, minio_path, schema_json, row_count, partition_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        datasetId,
        baseName.replace(/\.[^/.]+$/, ''),  // strip extension for display name
        originalName,
        rawMinioPath,
        JSON.stringify(schema),
        rows.length,
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

    console.log(`[Partitioner] Dataset ${datasetId}: ${rows.length} rows → ${partitionMeta.length} partitions`)

    return {
      datasetId,
      rowCount: rows.length,
      schema,
      partitionCount: partitionMeta.length,
      partitionIds
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = { initBuckets, partitionAndStore, minioClient, PARTITIONS_BUCKET }
