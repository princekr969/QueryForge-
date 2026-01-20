'use strict'

/**
 * queryPlanner.js
 * Parses SQL using node-sql-parser and generates an execution plan.
 */

const { Parser } = require('node-sql-parser')
const { trace }  = require('@opentelemetry/api')

const parser = new Parser()
const tracer = trace.getTracer('coordinator')

/**
 * Recursively walk a WHERE AST node and extract flat predicate list.
 * Supports AND-joined conditions only (per spec).
 *
 * @param {object|null} whereNode
 * @returns {Array<{column, operator, value, type}>}
 */
function extractPredicates (whereNode) {
  if (!whereNode) return []

  // AND node — recurse both sides
  if (whereNode.type === 'binary_expr' && whereNode.operator === 'AND') {
    return [
      ...extractPredicates(whereNode.left),
      ...extractPredicates(whereNode.right)
    ]
  }

  // Comparison operator
  if (whereNode.type === 'binary_expr') {
    const op      = whereNode.operator  // >, <, =, >=, <=, !=
    const left    = whereNode.left
    const right   = whereNode.right

    // column op literal
    if (left.type === 'column_ref' && right.type === 'number') {
      return [{
        column:   left.column,
        operator: op,
        value:    String(right.value),
        type:     'number'
      }]
    }

    if (left.type === 'column_ref' && right.type === 'single_quote_string') {
      return [{
        column:   left.column,
        operator: op,
        value:    right.value,
        type:     'string'
      }]
    }

    // Also handle double-quoted or unquoted string literals
    if (left.type === 'column_ref' && (right.type === 'string' || right.type === 'double_quote_string')) {
      return [{
        column:   left.column,
        operator: op,
        value:    right.value,
        type:     'string'
      }]
    }
  }

  return []
}

/**
 * Extract aggregation functions from the SELECT columns array.
 *
 * @param {Array} columns  - ast.columns
 * @returns {Array<{function, column, alias}>}
 */
function extractAggregations (columns) {
  if (!columns || columns === '*') return []

  const aggs = []
  for (const col of columns) {
    if (col.expr && col.expr.type === 'aggr_func') {
      const fn = col.expr.name.toUpperCase()  // COUNT, SUM, AVG
      let column = '*'
      if (col.expr.args && col.expr.args.expr) {
        const argExpr = col.expr.args.expr
        column = argExpr.type === 'star' ? '*' : argExpr.column
      }
      aggs.push({
        function: fn,
        column,
        alias: col.as || `${fn.toLowerCase()}_${column}`
      })
    }
  }
  return aggs
}

/**
 * Extract plain (non-aggregate) column names from SELECT.
 *
 * @param {Array|string} columns - ast.columns
 * @returns {string[]}  - column names, or ['*'] for SELECT *
 */
function extractSelectColumns (columns) {
  if (!columns || columns === '*') return ['*']

  return columns
    .filter(col => col.expr && col.expr.type === 'column_ref')
    .map(col => col.expr.column)
}

/**
 * Parse SQL and return a structured execution plan.
 *
 * @param {string} sql
 * @returns {{
 *   tableName: string,
 *   selectColumns: string[],
 *   predicates: object[],
 *   groupByColumns: string[],
 *   aggregations: object[],
 *   orderByColumn: string,
 *   orderByDirection: string,
 *   limit: number
 * }}
 */
function buildExecutionPlan (sql) {
  const span = tracer.startSpan('query.plan', {
    attributes: { 'sql': sql.slice(0, 200) }
  })

  try {
    let ast
    try {
      ast = parser.astify(sql, { database: 'PostgreSQL' })
    } catch (err) {
      throw new Error(`SQL parse error: ${err.message}`)
    }

    // Handle array result (multiple statements — take first)
    if (Array.isArray(ast)) ast = ast[0]

    if (!ast || ast.type !== 'select') {
      throw new Error('Only SELECT statements are supported')
    }

    // ── Table name ──────────────────────────────────────────────────────────────
    if (!ast.from || ast.from.length === 0) {
      throw new Error('SELECT must specify a FROM table')
    }
    const tableName = ast.from[0].table

    // ── Predicates (WHERE pushdown) ─────────────────────────────────────────────
    const predicates = extractPredicates(ast.where)

    // ── Aggregations ─────────────────────────────────────────────────────────────
    const aggregations = extractAggregations(ast.columns)

    // ── Plain select columns (excluding aggr_func columns) ──────────────────────
    const selectColumns = extractSelectColumns(ast.columns)

    // ── GROUP BY ─────────────────────────────────────────────────────────────────
    const groupByColumns = ast.groupby
      ? ast.groupby.map(g => g.column || g.expr?.column).filter(Boolean)
      : []

    // ── ORDER BY ─────────────────────────────────────────────────────────────────
    let orderByColumn    = ''
    let orderByDirection = 'ASC'
    if (ast.orderby && ast.orderby.length > 0) {
      const ob = ast.orderby[0]
      orderByColumn    = ob.expr?.column || ''
      orderByDirection = (ob.type || 'ASC').toUpperCase()
    }

    // ── LIMIT ─────────────────────────────────────────────────────────────────────
    let limit = 0
    if (ast.limit) {
      const limitVal = ast.limit.value
      if (Array.isArray(limitVal) && limitVal.length > 0) {
        limit = parseInt(limitVal[limitVal.length - 1].value, 10) || 0
      } else if (typeof limitVal === 'number') {
        limit = limitVal
      }
    }

    span.setAttributes({
      'query.table':        tableName,
      'query.predicates':   predicates.length,
      'query.aggregations': aggregations.length,
      'query.group_by':     groupByColumns.length
    })

    return {
      tableName,
      selectColumns,
      predicates,
      groupByColumns,
      aggregations,
      orderByColumn,
      orderByDirection,
      limit
    }
  } catch (err) {
    span.recordException(err)
    throw err
  } finally {
    span.end()
  }
}

module.exports = { buildExecutionPlan }
