'use strict'

const express          = require('express')
const { v4: uuidv4 }   = require('uuid')
const db               = require('../db')
const { executeQuery } = require('../services/jobManager')

const router = express.Router()

// POST /api/query — submit a SQL query, returns jobId immediately
// Client subscribes via WebSocket BEFORE results stream in
router.post('/', async (req, res) => {
  const { sql, datasetId } = req.body

  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'sql is required' })
  }

  // Only SELECT statements allowed — reject INSERT/UPDATE/DELETE/DROP etc.
  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT')) {
    return res.status(400).json({ error: 'Only SELECT statements are supported' })
  }

  if (!datasetId) {
    return res.status(400).json({ error: 'datasetId is required' })
  }

  // Validate dataset exists before fire-and-forget
  try {
    const dsCheck = await db.query('SELECT id FROM datasets WHERE id = $1', [datasetId])
    if (dsCheck.rows.length === 0) {
      return res.status(404).json({ error: `Dataset ${datasetId} not found` })
    }
  } catch (err) {
    console.error('[Route POST /query] DB check error:', err.message)
    return res.status(500).json({ error: 'Database error checking dataset' })
  }

  // Pre-generate jobId so we can return it immediately.
  // Client subscribes to this jobId via WebSocket right after getting this response.
  const jobId = uuidv4()

  // Fire-and-forget — results stream to WebSocket subscribers
  executeQuery(sql, datasetId, jobId).catch(err => {
    console.error(`[Route POST /query] Job ${jobId} failed:`, err.message)
  })

  res.status(202).json({ jobId })
})

// GET /api/query/jobs/:id — job status + task details
router.get('/jobs/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM jobs WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' })
    }

    const tasksResult = await db.query(
      'SELECT * FROM tasks WHERE job_id = $1 ORDER BY started_at',
      [req.params.id]
    )

    res.json({ job: result.rows[0], tasks: tasksResult.rows })
  } catch (err) {
    console.error('[Route GET /query/jobs/:id] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
