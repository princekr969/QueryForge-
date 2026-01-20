'use strict'

require('dotenv').config()

process.on('uncaughtException', (err) => {
  console.error('[Coordinator] Uncaught exception:', err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[Coordinator] Unhandled rejection:', reason)
  // Do not exit — log and continue
})

const express  = require('express')
const http     = require('http')
const cors     = require('cors')

const { initBuckets }                      = require('./services/partitioner')
const { startCoordinatorGrpcServer,
        heartbeatCheckInterval }           = require('./grpc/coordinatorServer')
const { attachWebSocketServer }            = require('./websocket/wsServer')
const { startFaultMonitor }               = require('./services/faultMonitor')
const db                                   = require('./db')

const datasetsRouter = require('./routes/datasets')
const queryRouter    = require('./routes/query')
const workersRouter  = require('./routes/workers')
const explainRouter  = require('./routes/explain')

const PORT = parseInt(process.env.PORT || '3000', 10)

let grpcServer  = null
let httpServer  = null
let faultTimer  = null

async function main () {
  console.log('[Coordinator] Initialising MinIO buckets...')
  await initBuckets()

  console.log('[Coordinator] Starting gRPC server...')
  grpcServer = await startCoordinatorGrpcServer()

  const app = express()
  app.use(cors())
  app.use(express.json())

  app.use('/api/datasets', datasetsRouter)
  app.use('/api/query',    queryRouter)
  app.use('/api/workers',  workersRouter)
  app.use('/api/explain',  explainRouter)
  app.get('/api/health',   (req, res) => res.json({ status: 'ok', ts: Date.now() }))

  app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }))
  app.use((err, req, res, _next) => {
    console.error('[Coordinator] Express error:', err.message)
    res.status(500).json({ error: err.message })
  })

  httpServer = http.createServer(app)
  attachWebSocketServer(httpServer)

  faultTimer = startFaultMonitor()

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Coordinator] HTTP + WebSocket listening on port ${PORT}`)
  })
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown (signal) {
  console.log(`[Coordinator] ${signal} received — shutting down gracefully`)

  if (faultTimer)            clearInterval(faultTimer)
  if (heartbeatCheckInterval) clearInterval(heartbeatCheckInterval)

  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve))
  }

  if (grpcServer) {
    await new Promise(resolve => grpcServer.tryShutdown(resolve))
  }

  await db.end()
  console.log('[Coordinator] Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

main().catch(err => {
  console.error('[Coordinator] Fatal startup error:', err)
  process.exit(1)
})
