'use strict'

const { Pool } = require('pg')

const pool = new Pool({
  connectionString:        process.env.DATABASE_URL,
  max:                     20,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 2_000
})

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message)
})

async function query (text, params) {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DB] ${Date.now() - start}ms: ${text.slice(0, 80)}`)
    }
    return result
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nSQL:', text)
    throw err
  }
}

async function getClient () {
  return pool.connect()
}

async function end () {
  return pool.end()
}

module.exports = { query, getClient, end }
