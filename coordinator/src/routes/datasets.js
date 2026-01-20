'use strict'

const express  = require('express')
const multer   = require('multer')
const db       = require('../db')
const { partitionAndStore } = require('../services/partitioner')

const router  = express.Router()

// Multer: memory storage, 500MB limit, CSV files only
const csvFileFilter = (req, file, cb) => {
  if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
    cb(null, true)
  } else {
    cb(new Error('Only CSV files are supported'), false)
  }
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },  // 1GB
  fileFilter: csvFileFilter
})

// POST /api/datasets/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use field name "file".' })
    }

    if (!req.file.originalname.toLowerCase().endsWith('.csv')) {
      return res.status(400).json({ error: 'Only CSV files are supported' })
    }

    const { datasetId, rowCount, schema, partitionCount } = await partitionAndStore(
      req.file.buffer,
      req.file.originalname,
      3
    )

    res.status(201).json({ datasetId, rowCount, schema, partitionCount })
  } catch (err) {
    console.error('[Route /upload] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/datasets
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, original_filename, row_count, partition_count, schema_json, created_at FROM datasets ORDER BY created_at DESC'
    )
    res.json(result.rows)
  } catch (err) {
    console.error('[Route GET /datasets] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/datasets/:id
router.get('/:id', async (req, res) => {
  try {
    const dsResult = await db.query('SELECT * FROM datasets WHERE id = $1', [req.params.id])
    if (dsResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dataset not found' })
    }

    const partResult = await db.query(
      'SELECT * FROM partitions WHERE dataset_id = $1 ORDER BY partition_index',
      [req.params.id]
    )

    res.json({ dataset: dsResult.rows[0], partitions: partResult.rows })
  } catch (err) {
    console.error('[Route GET /datasets/:id] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
