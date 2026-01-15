'use strict'

/**
 * aggregator.js
 * Local GROUP BY partial aggregation on a worker.
 * Builds a hash map: groupKey → { count, sums, groupValues }
 * The coordinator merges these from all workers in the final reduce step.
 */

/**
 * Create an empty aggregation state.
 */
function createAggState () {
  return {
    count:       0,
    sums:        {},
    maxVals:     {},
    minVals:     {},
    groupValues: {}
  }
}

/**
 * Update an aggregation state with a new matching row.
 *
 * @param {object}   state        - current aggregation state for this group key
 * @param {object}   row          - CSV row (all values are strings)
 * @param {object[]} aggregations - [{ function, column, alias }]
 */
function updateAggState (state, row, aggregations) {
  state.count++

  for (const agg of aggregations) {
    if (agg.function === 'COUNT') continue

    const col = agg.column
    if (!col || col === '*') continue
    const numVal = parseFloat(row[col])
    if (isNaN(numVal)) continue

    if (agg.function === 'SUM' || agg.function === 'AVG') {
      state.sums[col] = (state.sums[col] || 0) + numVal
    } else if (agg.function === 'MAX') {
      const key = `__max__${col}`
      if (state.sums[key] === undefined || numVal > state.sums[key]) {
        state.sums[key] = numVal
      }
    } else if (agg.function === 'MIN') {
      const key = `__min__${col}`
      if (state.sums[key] === undefined || numVal < state.sums[key]) {
        state.sums[key] = numVal
      }
    }  }
}

/**
 * Run local GROUP BY aggregation over an array of filtered rows.
 *
 * @param {object[]} rows           - rows that passed predicate filters
 * @param {string[]} groupByColumns - GROUP BY column names
 * @param {object[]} aggregations   - aggregation function descriptors
 * @returns {object[]} AggregationGroup-shaped objects ready for proto serialisation
 */
function localGroupBy (rows, groupByColumns, aggregations) {
  const hashMap = {}  // groupKey → aggregation state

  for (const row of rows) {
    // Build composite group key
    const groupKey = groupByColumns.map(col => String(row[col] ?? '')).join('|')

    if (!hashMap[groupKey]) {
      const state = createAggState()

      // Record the group-by column values for output reconstruction
      for (const col of groupByColumns) {
        state.groupValues[col] = String(row[col] ?? '')
      }

      hashMap[groupKey] = state
    }

    updateAggState(hashMap[groupKey], row, aggregations)
  }

  return Object.entries(hashMap).map(([groupKey, state]) => ({
    group_key:    groupKey,
    count:        state.count,
    sums:         state.sums,
    max_vals:     state.maxVals,
    min_vals:     state.minVals,
    group_values: state.groupValues
  }))
}

module.exports = { localGroupBy }
