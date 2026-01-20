'use strict'

/**
 * resultMerger.js
 * Merges partial results from all workers into a final result set.
 *
 * MAX/MIN travel inside the sums map with __max__<col> and __min__<col> keys.
 * This avoids needing new proto fields — sums map<string,double> carries them.
 */

function mergeResults (partialResults, plan) {
  if (partialResults.length === 0) return []

  const isAggregated = partialResults.some(pr => pr.is_aggregated)
  let finalRows = isAggregated
    ? mergeAggregated(partialResults, plan)
    : mergePlainRows(partialResults)

  // ORDER BY
  if (plan.orderByColumn) {
    const col = plan.orderByColumn
    const asc = plan.orderByDirection !== 'DESC'
    finalRows.sort((a, b) => {
      const an = parseFloat(a[col])
      const bn = parseFloat(b[col])
      if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an
      const as = String(a[col] || '')
      const bs = String(b[col] || '')
      if (asc) return as < bs ? -1 : as > bs ? 1 : 0
      return bs < as ? -1 : bs > as ? 1 : 0
    })
  }

  // LIMIT
  if (plan.limit > 0) {
    finalRows = finalRows.slice(0, plan.limit)
  }

  return finalRows
}

function mergePlainRows (partialResults) {
  const allRows = []
  for (const pr of partialResults) {
    if (!pr.rows || pr.rows.length === 0) continue
    const colNames = pr.column_names || []
    for (const row of pr.rows) {
      const values = row.values || []
      const obj = {}
      colNames.forEach((col, i) => { obj[col] = values[i] !== undefined ? values[i] : null })
      allRows.push(obj)
    }
  }
  return allRows
}

function mergeAggregated (partialResults, plan) {
  const finalMap = {}

  for (const pr of partialResults) {
    if (!pr.groups || pr.groups.length === 0) continue

    for (const group of pr.groups) {
      const key = group.group_key
      if (!finalMap[key]) {
        finalMap[key] = { count: 0, sums: {}, groupValues: {} }
      }

      // Merge count
      finalMap[key].count += Number(group.count) || 0

      // Merge sums (includes __max__ and __min__ prefixed keys)
      if (group.sums) {
        Object.entries(group.sums).forEach(([col, partialVal]) => {
          const n = Number(partialVal) || 0
          if (col.startsWith('__max__')) {
            // MAX: keep highest value across workers
            if (finalMap[key].sums[col] === undefined || n > finalMap[key].sums[col]) {
              finalMap[key].sums[col] = n
            }
          } else if (col.startsWith('__min__')) {
            // MIN: keep lowest value across workers
            if (finalMap[key].sums[col] === undefined || n < finalMap[key].sums[col]) {
              finalMap[key].sums[col] = n
            }
          } else {
            // SUM/AVG: accumulate
            finalMap[key].sums[col] = (finalMap[key].sums[col] || 0) + n
          }
        })
      }

      // Copy group_values
      if (group.group_values) {
        Object.entries(group.group_values).forEach(([col, val]) => {
          finalMap[key].groupValues[col] = val
        })
      }
    }
  }

  // Build output rows
  const outputRows = []
  for (const [, merged] of Object.entries(finalMap)) {
    const row = {}

    // Group-by column values
    Object.entries(merged.groupValues).forEach(([col, val]) => { row[col] = val })

    // Aggregation results
    for (const agg of plan.aggregations) {
      if (agg.function === 'COUNT') {
        row[agg.alias] = merged.count
      } else if (agg.function === 'SUM') {
        row[agg.alias] = merged.sums[agg.column] || 0
      } else if (agg.function === 'AVG') {
        const total = merged.sums[agg.column] || 0
        row[agg.alias] = merged.count > 0 ? total / merged.count : 0
      } else if (agg.function === 'MAX') {
        row[agg.alias] = merged.sums[`__max__${agg.column}`] !== undefined
          ? merged.sums[`__max__${agg.column}`] : null
      } else if (agg.function === 'MIN') {
        row[agg.alias] = merged.sums[`__min__${agg.column}`] !== undefined
          ? merged.sums[`__min__${agg.column}`] : null
      }
    }

    outputRows.push(row)
  }

  return outputRows
}

module.exports = { mergeResults }
