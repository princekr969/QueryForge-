'use strict'

/**
 * Unit tests for predicateEvaluator.js
 * Tests WHERE clause predicate pushdown logic.
 *
 * Run with: node --test tests/predicateEvaluator.test.js
 */

const { applyPredicates } = require('../worker/src/services/predicateEvaluator')
const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

describe('predicateEvaluator — numeric predicates', () => {
  const row = { age: '30', salary: '75000', department: 'Engineering' }

  it('passes row when numeric > predicate is satisfied', () => {
    const result = applyPredicates(row, [{ column: 'age', operator: '>', value: '25', type: 'number' }])
    assert.equal(result, true)
  })

  it('rejects row when numeric > predicate is not satisfied', () => {
    const result = applyPredicates(row, [{ column: 'age', operator: '>', value: '35', type: 'number' }])
    assert.equal(result, false)
  })

  it('passes row when numeric >= predicate matches exactly', () => {
    const result = applyPredicates(row, [{ column: 'age', operator: '>=', value: '30', type: 'number' }])
    assert.equal(result, true)
  })

  it('passes row when numeric < predicate is satisfied', () => {
    const result = applyPredicates(row, [{ column: 'salary', operator: '<', value: '100000', type: 'number' }])
    assert.equal(result, true)
  })

  it('passes row when numeric = predicate matches', () => {
    const result = applyPredicates(row, [{ column: 'age', operator: '=', value: '30', type: 'number' }])
    assert.equal(result, true)
  })

  it('rejects row when numeric = predicate does not match', () => {
    const result = applyPredicates(row, [{ column: 'age', operator: '=', value: '31', type: 'number' }])
    assert.equal(result, false)
  })

  it('passes row when != predicate is satisfied', () => {
    const result = applyPredicates(row, [{ column: 'age', operator: '!=', value: '99', type: 'number' }])
    assert.equal(result, true)
  })

  it('rejects row with non-numeric value for numeric predicate', () => {
    const badRow = { age: 'N/A' }
    const result = applyPredicates(badRow, [{ column: 'age', operator: '>', value: '25', type: 'number' }])
    assert.equal(result, false)
  })
})

describe('predicateEvaluator — string predicates', () => {
  const row = { department: 'Engineering', city: 'Mumbai' }

  it('passes row when string = predicate matches', () => {
    const result = applyPredicates(row, [{ column: 'city', operator: '=', value: 'Mumbai', type: 'string' }])
    assert.equal(result, true)
  })

  it('rejects row when string = predicate does not match', () => {
    const result = applyPredicates(row, [{ column: 'city', operator: '=', value: 'Delhi', type: 'string' }])
    assert.equal(result, false)
  })

  it('passes row when string != predicate is satisfied', () => {
    const result = applyPredicates(row, [{ column: 'city', operator: '!=', value: 'Delhi', type: 'string' }])
    assert.equal(result, true)
  })
})

describe('predicateEvaluator — multiple predicates (AND logic)', () => {
  const row = { age: '28', salary: '80000', city: 'Mumbai' }

  it('passes row when all predicates are satisfied', () => {
    const result = applyPredicates(row, [
      { column: 'age', operator: '>', value: '25', type: 'number' },
      { column: 'salary', operator: '>', value: '60000', type: 'number' },
      { column: 'city', operator: '=', value: 'Mumbai', type: 'string' }
    ])
    assert.equal(result, true)
  })

  it('rejects row when any one predicate fails', () => {
    const result = applyPredicates(row, [
      { column: 'age', operator: '>', value: '25', type: 'number' },
      { column: 'salary', operator: '>', value: '100000', type: 'number' } // fails
    ])
    assert.equal(result, false)
  })
})

describe('predicateEvaluator — edge cases', () => {
  it('returns true when predicates array is empty', () => {
    const result = applyPredicates({ age: '25' }, [])
    assert.equal(result, true)
  })

  it('returns false when column is missing from row', () => {
    const result = applyPredicates({ name: 'John' }, [{ column: 'age', operator: '>', value: '25', type: 'number' }])
    assert.equal(result, false)
  })
})
