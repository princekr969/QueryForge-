'use strict'

/**
 * predicateEvaluator.js
 * Applies WHERE clause predicates to a single CSV row.
 *
 * CRITICAL: All CSV values arrive as strings — always cast before numeric compare.
 *           row['salary'] > 50000 is string comparison and will give wrong results.
 *           Always use: parseFloat(row['salary']) > 50000
 */

/**
 * Test a single predicate against a row.
 *
 * @param {object} row        - plain object, all values are strings
 * @param {object} predicate  - { column, operator, value, type }
 * @returns {boolean}
 */
function testPredicate (row, predicate) {
  const { column, operator, value, type } = predicate

  // Column missing from row — row doesn't match
  if (!(column in row)) return false

  const rawValue = row[column]

  if (type === 'number') {
    // Cast both sides to float for numeric comparison
    const rowNum   = parseFloat(rawValue)
    const predNum  = parseFloat(value)

    if (isNaN(rowNum)) return false

    switch (operator) {
      case '>':  return rowNum >  predNum
      case '<':  return rowNum <  predNum
      case '=':
      case '==': return rowNum === predNum
      case '>=': return rowNum >= predNum
      case '<=': return rowNum <= predNum
      case '!=':
      case '<>': return rowNum !== predNum
      default:   return false
    }
  } else {
    // String comparison
    const rowStr  = String(rawValue)
    const predStr = String(value)

    switch (operator) {
      case '=':
      case '==': return rowStr === predStr
      case '!=':
      case '<>': return rowStr !== predStr
      case '>':  return rowStr >  predStr
      case '<':  return rowStr <  predStr
      case '>=': return rowStr >= predStr
      case '<=': return rowStr <= predStr
      default:   return false
    }
  }
}

/**
 * Test all predicates against a row — all must pass (AND logic).
 *
 * @param {object}   row
 * @param {object[]} predicates
 * @returns {boolean}
 */
function applyPredicates (row, predicates) {
  if (!predicates || predicates.length === 0) return true
  return predicates.every(pred => testPredicate(row, pred))
}

module.exports = { applyPredicates }
