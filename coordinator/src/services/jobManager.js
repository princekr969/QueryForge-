'use strict'

/**
 * jobManager.js
 * Creates and tracks Jobs and Tasks in PostgreSQL.
 * Dispatches tasks to workers via gRPC and drives the full query lifecycle.
 */

const { v4: uuidv4 }         = require('uuid')
const db                      = require('../db')
const { executeTaskOnWorker } = require('../grpc/workerClient')
const { workerRegistry }      = require('../grpc/coordinatorServer')
const { buildExecutionPlan }  = require('./queryPlanner')
const { mergeResults }        = require('./resultMerger')
const { getJobSubscribers }   = require('../websocket/wsServer')

// OTel
const { metrics, trace } = require('@opentelemetry/api')
const meter  = metrics.getMeter('coordinator')
const tracer = trace.getTracer('coordinator')

const queryDurationHistogram = meter.createHistogram('dataforge_query_duration_ms', {
  description: 'End-to-end query execution time in milliseconds'
})
const tasksCounter = meter.createCounter('dataforge_tasks_total', {
  description: 'Total tasks created, by status'
})
const activeWorkersGauge = meter.createObservableGauge('dataforge_active_workers', {
  description: 'Number of currently active workers'
})
// addBatchObservableCallback is the correct API for observable gauges in OTel JS SDK
meter.addBatchObservableCallback((observableResult) => {
  let count = 0
  for (const [, w] of workerRegistry.entries()) {
    if (w.status === 'active') count++
  }
  observableResult.observe(activeWorkersGauge, count)
}, [activeWorkersGauge])

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActiveWorkers () {
  const active = []
  for (const [, w] of workerRegistry.entries()) {
    if (w.status === 'active') active.push(w)
  }
  return active
}

function pushToSubscribers (jobId, event) {
  const subscribers = getJobSubscribers(jobId)
  const payload     = JSON.stringify(event)
  for (const ws of subscribers) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(payload)
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Execute a full distributed query.
 *
 * @param {string} sql
 * @param {string} datasetId
 * @param {string} [preGeneratedJobId] - pre-generated so route can return it before execution starts
 * @returns {Promise<{ jobId: string }>}
 */
async function executeQuery (sql, datasetId, preGeneratedJobId) {
  const jobId   = preGeneratedJobId || uuidv4()
  const startMs = Date.now()

  const span = tracer.startSpan('job.execute', {
    attributes: {
      'job.id':     jobId,
      'dataset.id': datasetId,
      'worker.count': 3
    }
  })

  try {
    // ── 1. Parse SQL → execution plan ───────────────────────────────────────────
    let plan
    try {
      plan = buildExecutionPlan(sql)
    } catch (err) {
      throw new Error(`Query plan error: ${err.message}`)
    }

    // ── 2. Look up dataset + partitions ─────────────────────────────────────────
    const dsResult = await db.query('SELECT * FROM datasets WHERE id = $1', [datasetId])
    if (dsResult.rows.length === 0) throw new Error(`Dataset ${datasetId} not found`)

    const partResult = await db.query(
      'SELECT * FROM partitions WHERE dataset_id = $1 ORDER BY partition_index',
      [datasetId]
    )
    const partitions = partResult.rows

    // ── 3. Create job record in DB ───────────────────────────────────────────────
    await db.query(
      `INSERT INTO jobs (id, sql_query, dataset_id, status) VALUES ($1, $2, $3, 'running')`,
      [jobId, sql, datasetId]
    )

    const activeWorkers = getActiveWorkers()
    if (activeWorkers.length === 0) {
      await db.query(`UPDATE jobs SET status = 'failed', completed_at = NOW() WHERE id = $1`, [jobId])
      throw new Error('No active workers available')
    }

    // ── 4. Create tasks (round-robin across workers) ─────────────────────────────
    const taskAssignments = []
    for (let i = 0; i < partitions.length; i++) {
      const worker    = activeWorkers[i % activeWorkers.length]
      const partition = partitions[i]
      const taskId    = uuidv4()

      await db.query(
        `INSERT INTO tasks (id, job_id, worker_id, partition_id, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [taskId, jobId, worker.workerId, partition.id]
      )
      taskAssignments.push({ taskId, worker, partition })
    }

    // Mark all tasks as running
    for (const ta of taskAssignments) {
      await db.query(
        `UPDATE tasks SET status = 'running', started_at = NOW() WHERE id = $1`,
        [ta.taskId]
      )
      tasksCounter.add(1, { status: 'running' })
    }

    pushToSubscribers(jobId, {
      type: 'progress',
      completedTasks: 0,
      totalTasks: taskAssignments.length
    })

    // ── 5. Dispatch tasks in parallel ─────────────────────────────────────────────
    const workerAddress = (w) => `${w.address}:${w.port}`

    const taskPromises = taskAssignments.map(async ({ taskId, worker, partition }) => {
      const taskRequest = {
        task_id:            taskId,
        job_id:             jobId,
        partition_path:     partition.minio_path,
        predicates:         plan.predicates,
        select_columns:     plan.selectColumns,
        group_by_columns:   plan.groupByColumns,
        aggregations:       plan.aggregations,
        order_by_column:    plan.orderByColumn,
        order_by_direction: plan.orderByDirection,
        limit:              plan.limit
      }

      try {
        const partialResults = await executeTaskOnWorker(workerAddress(worker), taskRequest)

        const rowsReturned = partialResults.reduce(
          (sum, pr) => sum + (pr.rows?.length || pr.groups?.length || 0), 0
        )
        // rows_processed is set by worker via OTel counter — use partialResults metadata
        // Extract rows_scanned from first partial result if worker sends it
        const rowsScanned = partialResults[0]?.rows_scanned || rowsReturned

        await db.query(
          `UPDATE tasks SET status = 'completed', completed_at = NOW(),
           rows_processed = $2 WHERE id = $1`,
          [taskId, rowsReturned]
        )
        tasksCounter.add(1, { status: 'completed' })
        return { success: true, taskId, partialResults, metrics: { rowsScanned, rowsReturned, workerId: worker.workerId } }
      } catch (err) {
        console.error(`[JobManager] Task ${taskId} failed on ${workerAddress(worker)}:`, err.message)
        await db.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1`,
          [taskId, err.message]
        )
        tasksCounter.add(1, { status: 'failed' })
        return { success: false, taskId, partialResults: [], error: err.message }
      }
    })

    const taskResults = await Promise.all(taskPromises)

    pushToSubscribers(jobId, {
      type: 'progress',
      completedTasks: taskResults.length,
      totalTasks: taskResults.length
    })

    // ── 6. Merge partial results ──────────────────────────────────────────────────
    const allPartialResults = taskResults.flatMap(tr => tr.partialResults)
    const finalRows         = mergeResults(allPartialResults, plan)

    // ── 7. Stream final rows to WebSocket subscribers ─────────────────────────────
    for (const row of finalRows) {
      pushToSubscribers(jobId, { type: 'row', data: row })
    }

    const executionTimeMs = Date.now() - startMs

    await db.query(
      `UPDATE jobs SET status = 'completed', completed_at = NOW(),
       result_row_count = $2, execution_time_ms = $3 WHERE id = $1`,
      [jobId, finalRows.length, executionTimeMs]
    )

    queryDurationHistogram.record(executionTimeMs)
    span.setAttributes({ 'job.result_rows': finalRows.length, 'job.duration_ms': executionTimeMs })

    // Build per-worker metrics for job completion event
    const workerMetrics = taskResults.map(tr => ({
      workerId:     tr.metrics?.workerId || 'unknown',
      rowsReturned: tr.metrics?.rowsReturned || 0,
      success:      tr.success
    }))

    pushToSubscribers(jobId, {
      type:           'complete',
      totalRows:      finalRows.length,
      executionTimeMs,
      workerMetrics
    })

    console.log(`[JobManager] Job ${jobId} completed in ${executionTimeMs}ms — ${finalRows.length} rows`)
    return { jobId }
  } catch (err) {
    span.recordException(err)
    // Mark job as failed
    try {
      await db.query(
        `UPDATE jobs SET status = 'failed', completed_at = NOW() WHERE id = $1 AND status != 'completed'`,
        [jobId]
      )
    } catch (dbErr) {
      console.error('[JobManager] Failed to mark job as failed:', dbErr.message)
    }
    pushToSubscribers(jobId, { type: 'error', message: err.message })
    throw err
  } finally {
    span.end()
  }
}

module.exports = { executeQuery }
