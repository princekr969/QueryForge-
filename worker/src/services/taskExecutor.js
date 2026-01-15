'use strict'

/**
 * taskExecutor.js
 * Core worker logic:
 *   1. Download partition CSV from MinIO to a temp file
 *   2. Stream rows from temp file, apply predicate filters (pushdown)
 *   3a. If GROUP BY → local partial aggregation
 *   3b. Otherwise   → collect filtered rows
 *   4. Stream results back via onResult callback
 *   5. Delete temp file
 */

const fs                             = require('fs')
const { parse }                      = require('csv-parse')
const { applyPredicates }            = require('./predicateEvaluator')
const { localGroupBy }               = require('./aggregator')
const { downloadPartitionToFile, cleanupTempFile } = require('./minioClient')

const { metrics, trace } = require('@opentelemetry/api')
const meter  = metrics.getMeter('worker')
const tracer = trace.getTracer('worker')

const rowsProcessedCounter = meter.createCounter('dataforge_rows_processed_total', {
  description: 'Total rows processed by this worker'
})

const BATCH_SIZE = 500

async function executeTask (request, onResult) {
  const {
    task_id,
    partition_path,
    predicates       = [],
    select_columns   = [],
    group_by_columns = [],
    aggregations     = []
  } = request

  const workerId = process.env.WORKER_ID || 'worker'

  const span = tracer.startSpan('task.execute', {
    attributes: {
      'task.id':        task_id,
      'worker.id':      workerId,
      'partition.path': partition_path
    }
  })

  let localPath = null

  try {
    console.log(`[TaskExecutor] Task ${task_id} — downloading partition: ${partition_path}`)

    // ── 1. Download to temp file ────────────────────────────────────────────────
    localPath = await downloadPartitionToFile(partition_path, task_id)

    // ── 2. Stream rows through predicate filter ─────────────────────────────────
    const { filteredRows, totalScanned } = await filterRowsFromFile(localPath, predicates)

    rowsProcessedCounter.add(totalScanned, { worker_id: workerId })
    span.setAttributes({ 'rows.scanned': totalScanned, 'rows.passed_filter': filteredRows.length })
    console.log(`[TaskExecutor] Task ${task_id} — scanned ${totalScanned}, ${filteredRows.length} passed filter (${((filteredRows.length/totalScanned)*100).toFixed(1)}% selectivity)`)

    const isAggregated = group_by_columns && group_by_columns.length > 0

    if (isAggregated) {
      // ── 3a. Local GROUP BY aggregation ──────────────────────────────────────
      const groups = localGroupBy(filteredRows, group_by_columns, aggregations)
      onResult({
        task_id,
        is_aggregated: true,
        column_names:  [],
        rows:          [],
        groups,
        is_complete:   true
      })
    } else {
      // ── 3b. Plain rows ────────────────────────────────────────────────────────
      let columnNames
      if (!select_columns || select_columns.length === 0 || select_columns[0] === '*') {
        columnNames = filteredRows.length > 0 ? Object.keys(filteredRows[0]) : []
      } else {
        columnNames = select_columns
      }

      if (filteredRows.length === 0) {
        onResult({ task_id, is_aggregated: false, column_names: columnNames, rows: [], groups: [], is_complete: true })
      } else {
        for (let i = 0; i < filteredRows.length; i += BATCH_SIZE) {
          const batch = filteredRows.slice(i, i + BATCH_SIZE)
          const protoRows = batch.map(row => ({
            values: columnNames.map(col => String(row[col] !== undefined ? row[col] : ''))
          }))
          onResult({
            task_id,
            is_aggregated: false,
            column_names:  columnNames,
            rows:          protoRows,
            groups:        [],
            is_complete:   i + BATCH_SIZE >= filteredRows.length
          })
        }
      }
    }
  } catch (err) {
    span.recordException(err)
    throw err
  } finally {
    span.end()
    // ── 5. Always clean up temp file ─────────────────────────────────────────
    if (localPath) cleanupTempFile(localPath)
  }
}

/**
 * Stream CSV rows from a local file, apply predicate filters row-by-row.
 * Returns { filteredRows, totalScanned }
 */
function filterRowsFromFile (localPath, predicates) {
  return new Promise((resolve, reject) => {
    const filteredRows = []
    let totalScanned   = 0
    const readStream   = fs.createReadStream(localPath)
    const parser       = parse({ columns: true, skip_empty_lines: true })

    readStream.pipe(parser)

    parser.on('data', (row) => {
      totalScanned++
      if (applyPredicates(row, predicates)) {
        filteredRows.push(row)
      }
    })

    parser.on('end',   () => resolve({ filteredRows, totalScanned }))
    parser.on('error', reject)
    readStream.on('error', reject)
  })
}

module.exports = { executeTask }
