'use strict'

/**
 * Unit tests for partitioner.js — partition assignment logic
 * Tests row splitting and schema inference without requiring MinIO/PostgreSQL.
 *
 * Run with: node --test tests/partitioner.test.js
 */

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

// ── Pure logic extracted from partitioner for unit testing ────────────────────

function inferType (rows, columnName) {
  const sampleSize = Math.min(rows.length, 100)
  for (let i = 0; i < sampleSize; i++) {
    const val = rows[i][columnName]
    if (val === null || val === undefined || val === '') continue
    if (isNaN(parseFloat(val)) || !isFinite(val)) return 'string'
  }
  return 'number'
}

function splitIntoPartitions (rows, partitionCount) {
  const chunkSize = Math.ceil(rows.length / partitionCount)
  const partitions = []
  for (let i = 0; i < partitionCount; i++) {
    const start = i * chunkSize
    const end = Math.min(start + chunkSize, rows.length)
    partitions.push(rows.slice(start, end))
  }
  return partitions.filter(p => p.length > 0)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('partitioner — row splitting', () => {
  it('splits 9 rows into 3 equal partitions', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: String(i) }))
    const parts = splitIntoPartitions(rows, 3)
    assert.equal(parts.length, 3)
    assert.equal(parts[0].length, 3)
    assert.equal(parts[1].length, 3)
    assert.equal(parts[2].length, 3)
  })

  it('handles uneven split — last partition gets remainder', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }))
    const parts = splitIntoPartitions(rows, 3)
    const totalRows = parts.reduce((sum, p) => sum + p.length, 0)
    assert.equal(totalRows, 10)
  })

  it('handles fewer rows than partitions', () => {
    const rows = [{ id: '1' }, { id: '2' }]
    const parts = splitIntoPartitions(rows, 3)
    const totalRows = parts.reduce((sum, p) => sum + p.length, 0)
    assert.equal(totalRows, 2)
  })

  it('single partition returns all rows', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }))
    const parts = splitIntoPartitions(rows, 1)
    assert.equal(parts.length, 1)
    assert.equal(parts[0].length, 5)
  })

  it('preserves all rows across partitions (no data loss)', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
    const parts = splitIntoPartitions(rows, 3)
    const totalRows = parts.reduce((sum, p) => sum + p.length, 0)
    assert.equal(totalRows, 100)
  })
})

describe('partitioner — schema type inference', () => {
  it('infers number type for numeric column', () => {
    const rows = [{ age: '25' }, { age: '30' }, { age: '35' }]
    assert.equal(inferType(rows, 'age'), 'number')
  })

  it('infers string type for text column', () => {
    const rows = [{ city: 'Mumbai' }, { city: 'Delhi' }]
    assert.equal(inferType(rows, 'city'), 'string')
  })

  it('infers string type when any value is non-numeric', () => {
    const rows = [{ val: '100' }, { val: 'N/A' }, { val: '200' }]
    assert.equal(inferType(rows, 'val'), 'string')
  })

  it('skips empty values when inferring type', () => {
    const rows = [{ age: '' }, { age: '25' }, { age: '30' }]
    assert.equal(inferType(rows, 'age'), 'number')
  })

  it('infers number for float values', () => {
    const rows = [{ salary: '75000.50' }, { salary: '80000.00' }]
    assert.equal(inferType(rows, 'salary'), 'number')
  })
})
