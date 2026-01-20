'use strict'

const express               = require('express')
const db                    = require('../db')
const { buildExecutionPlan } = require('../services/queryPlanner')

const router = express.Router()

/**
 * POST /api/explain
 * Body: { sql: string, datasetId: string }
 *
 * Returns the execution plan as JSON — shows exactly what will happen
 * before running the query. Like PostgreSQL's EXPLAIN.
 */
router.post('/', async (req, res) => {
  const { sql, datasetId } = req.body

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'sql is required' })
  }
  if (!datasetId) {
    return res.status(400).json({ error: 'datasetId is required' })
  }

  // Parse SQL → execution plan
  let plan
  try {
    plan = buildExecutionPlan(sql)
  } catch (err) {
    return res.status(400).json({ error: `SQL parse error: ${err.message}` })
  }

  // Look up dataset metadata
  let dataset, partitions
  try {
    const dsResult = await db.query('SELECT * FROM datasets WHERE id = $1', [datasetId])
    if (dsResult.rows.length === 0) {
      return res.status(404).json({ error: `Dataset ${datasetId} not found` })
    }
    dataset = dsResult.rows[0]

    const partResult = await db.query(
      'SELECT * FROM partitions WHERE dataset_id = $1 ORDER BY partition_index',
      [datasetId]
    )
    partitions = partResult.rows
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }

  // Estimate predicate selectivity from schema
  const schema = dataset.schema_json || { columns: [] }
  const totalRows = dataset.row_count || 0

  // Build the explain output
  const explainOutput = {
    query: sql,
    dataset: {
      name:            dataset.name,
      total_rows:      totalRows,
      partition_count: partitions.length
    },
    execution_plan: {
      operation:     plan.groupByColumns.length > 0 ? 'DISTRIBUTED_AGGREGATE' : 'DISTRIBUTED_SCAN',
      table:         plan.tableName,
      workers:       partitions.length,
      rows_per_worker: Math.ceil(totalRows / partitions.length)
    },
    predicate_pushdown: {
      enabled:    plan.predicates.length > 0,
      predicates: plan.predicates.map(p => ({
        column:   p.column,
        operator: p.operator,
        value:    p.value,
        type:     p.type,
        note:     'Applied row-by-row on worker BEFORE loading into memory'
      })),
      estimated_benefit: plan.predicates.length > 0
        ? 'Rows not matching WHERE are discarded immediately — never transferred to coordinator'
        : 'No WHERE clause — all rows will be transferred'
    },
    aggregation: {
      type: plan.groupByColumns.length > 0 ? 'PARTIAL_AGGREGATION' : 'NONE',
      group_by: plan.groupByColumns,
      functions: plan.aggregations.map(a => ({
        function:    a.function,
        column:      a.column,
        alias:       a.alias,
        worker_does: a.function === 'AVG'
          ? 'Computes local SUM + COUNT (never sends AVG directly)'
          : a.function === 'MAX' || a.function === 'MIN'
          ? `Computes local ${a.function} on its partition`
          : `Computes local ${a.function}`,
        coordinator_does: a.function === 'AVG'
          ? 'Merges: final_avg = total_sum / total_count across all workers'
          : a.function === 'MAX'
          ? 'Takes MAX of all worker MAX values'
          : a.function === 'MIN'
          ? 'Takes MIN of all worker MIN values'
          : 'Sums all worker partial results'
      })),
      note: plan.groupByColumns.length > 0
        ? 'Each worker builds a local hash map. Coordinator merges N hash maps — NOT N×rows'
        : null
    },
    ordering: plan.orderByColumn
      ? { column: plan.orderByColumn, direction: plan.orderByDirection, applied_at: 'coordinator — after all workers complete' }
      : null,
    limit: plan.limit > 0
      ? { value: plan.limit, applied_at: 'coordinator — after ORDER BY on merged results' }
      : null,
    partitions: partitions.map(p => ({
      index:      p.partition_index,
      minio_path: p.minio_path,
      row_count:  p.row_count,
      worker:     `worker-${p.partition_index + 1}`
    }))
  }

  res.json(explainOutput)
})

module.exports = router
