'use strict'

/**
 * faultMonitor.js
 * Monitors running tasks for timeouts and reassigns them to healthy workers
 * when a worker fails to complete within TASK_TIMEOUT_MS.
 */

const db                      = require('../db')
const { executeTaskOnWorker } = require('../grpc/workerClient')
const { workerRegistry }      = require('../grpc/coordinatorServer')
const { getJobSubscribers }   = require('../websocket/wsServer')

const TASK_TIMEOUT_MS   = 30_000  // 30 s
const TASK_TIMEOUT_SEC  = TASK_TIMEOUT_MS / 1000  // used in parameterized SQL
const CHECK_INTERVAL_MS = 5_000   // check every 5 s

function pushToSubscribers (jobId, event) {
  const subscribers = getJobSubscribers(jobId)
  const payload     = JSON.stringify(event)
  for (const ws of subscribers) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(payload)
    }
  }
}

function getActiveWorkers () {
  const active = []
  for (const [, w] of workerRegistry.entries()) {
    if (w.status === 'active') active.push(w)
  }
  return active
}

/**
 * Start the background fault monitor.
 * Scans for timed-out tasks every CHECK_INTERVAL_MS.
 */
function startFaultMonitor () {
  console.log('[FaultMonitor] Started — task timeout:', TASK_TIMEOUT_MS, 'ms')

  const interval = setInterval(async () => {
    try {
      // Use parameterized interval — no string interpolation in SQL
      const result = await db.query(
        `SELECT t.*, p.minio_path AS partition_path, j.sql_query,
                j.id AS job_id_ref
         FROM tasks t
         JOIN partitions p ON p.id = t.partition_id
         JOIN jobs      j ON j.id = t.job_id
         WHERE t.status = 'running'
           AND t.started_at < NOW() - ($1 * INTERVAL '1 second')`,
        [TASK_TIMEOUT_SEC]
      )

      for (const task of result.rows) {
        console.warn(`[FaultMonitor] Task ${task.id} timed out on worker ${task.worker_id}`)

        // Count how many times this partition has already been reassigned
        const reassignCount = await db.query(
          `SELECT COUNT(*) as cnt FROM tasks
           WHERE job_id = $1 AND partition_id = $2 AND status IN ('reassigned', 'failed')`,
          [task.job_id, task.partition_id]
        )
        const attempts = parseInt(reassignCount.rows[0].cnt, 10)

        if (attempts >= 3) {
          console.error(`[FaultMonitor] Partition ${task.partition_id} failed 3 times — marking job failed`)
          await db.query(
            `UPDATE tasks SET status = 'failed', error_message = $2 WHERE id = $1`,
            [task.id, 'Max reassignment attempts (3) reached']
          )
          await db.query(
            `UPDATE jobs SET status = 'failed', completed_at = NOW() WHERE id = $1`,
            [task.job_id]
          )
          pushToSubscribers(task.job_id, {
            type: 'error',
            message: 'Query failed: a partition could not be processed after 3 attempts'
          })
          continue
        }

        const activeWorkers = getActiveWorkers()
        const newWorker     = activeWorkers.find(w => w.workerId !== task.worker_id)

        if (!newWorker) {
          console.error(`[FaultMonitor] No alternative worker available for task ${task.id}`)
          await db.query(
            `UPDATE tasks SET status = 'failed', error_message = $2 WHERE id = $1`,
            [task.id, 'Worker timed out and no replacement worker available']
          )
          continue
        }

        // Mark old task as reassigned
        await db.query(
          `UPDATE tasks SET status = 'reassigned', completed_at = NOW() WHERE id = $1`,
          [task.id]
        )

        // Create a new task for the same partition on the new worker
        const newTaskRes = await db.query(
          `INSERT INTO tasks (job_id, worker_id, partition_id, status, started_at)
           VALUES ($1, $2, $3, 'running', NOW()) RETURNING id`,
          [task.job_id, newWorker.workerId, task.partition_id]
        )

        const newTaskId = newTaskRes.rows[0].id
        console.log(`[FaultMonitor] Reassigned task to ${newWorker.workerId}, new task ID: ${newTaskId}`)

        pushToSubscribers(task.job_id, {
          type: 'reassignment',
          oldTaskId: task.id,
          newTaskId,
          newWorkerId: newWorker.workerId
        })

        // Retrieve original job plan from jobs table to reconstruct full TaskRequest
        const jobPlanResult = await db.query(
          `SELECT sql_query FROM jobs WHERE id = $1`,
          [task.job_id]
        )

        let taskRequest = {
          task_id:        newTaskId,
          job_id:         task.job_id,
          partition_path: task.partition_path,
          predicates:         [],
          select_columns:     [],
          group_by_columns:   [],
          aggregations:       [],
          order_by_column:    '',
          order_by_direction: 'ASC',
          limit:              0
        }

        // Re-parse the SQL to reconstruct execution plan for the reassigned task
        if (jobPlanResult.rows.length > 0) {
          try {
            const { buildExecutionPlan } = require('./queryPlanner')
            const plan = buildExecutionPlan(jobPlanResult.rows[0].sql_query)
            taskRequest = {
              task_id:            newTaskId,
              job_id:             task.job_id,
              partition_path:     task.partition_path,
              predicates:         plan.predicates,
              select_columns:     plan.selectColumns,
              group_by_columns:   plan.groupByColumns,
              aggregations:       plan.aggregations,
              order_by_column:    plan.orderByColumn,
              order_by_direction: plan.orderByDirection,
              limit:              plan.limit
            }
          } catch (planErr) {
            console.error('[FaultMonitor] Could not re-parse job SQL for reassignment:', planErr.message)
          }
        }

        // Fire-and-forget reassigned task execution
        executeTaskOnWorker(
          `${newWorker.address}:${newWorker.port}`,
          taskRequest
        ).then(async () => {
          await db.query(
            `UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`,
            [newTaskId]
          )
        }).catch(async (err) => {
          console.error(`[FaultMonitor] Reassigned task ${newTaskId} also failed:`, err.message)
          await db.query(
            `UPDATE tasks SET status = 'failed', error_message = $2 WHERE id = $1`,
            [newTaskId, err.message]
          )
        })
      }
    } catch (err) {
      console.error('[FaultMonitor] Check failed:', err.message)
    }
  }, CHECK_INTERVAL_MS)

  return interval
}

module.exports = { startFaultMonitor }
