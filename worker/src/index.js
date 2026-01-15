'use strict'

require('dotenv').config()

process.on('uncaughtException', (err) => {
  console.error(`[Worker] Uncaught exception:`, err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error(`[Worker] Unhandled rejection:`, reason)
})

const { registerWithCoordinator } = require('./grpc/coordinatorClient')
const { startWorkerGrpcServer }   = require('./grpc/workerServer')
const { startHeartbeat }          = require('./heartbeat')

const WORKER_ID   = process.env.WORKER_ID   || 'worker-unknown'
const WORKER_PORT = parseInt(process.env.WORKER_PORT || '50051', 10)
const WORKER_HOST = WORKER_ID  // Docker Compose service name = hostname

let grpcServer       = null
let heartbeatTimer   = null

async function main () {
  console.log(`[Worker] Starting ${WORKER_ID} on port ${WORKER_PORT}`)

  // 1. Start gRPC server FIRST — coordinator will call back on it during task assignment
  grpcServer = await startWorkerGrpcServer(WORKER_PORT)

  // 2. Register with coordinator (retries until coordinator is ready)
  await registerWithCoordinator(WORKER_ID, WORKER_HOST, WORKER_PORT)

  // 3. Start heartbeat immediately after registration
  heartbeatTimer = startHeartbeat(WORKER_ID)

  console.log(`[Worker] ${WORKER_ID} ready and accepting tasks`)
}

async function shutdown (signal) {
  console.log(`[Worker] ${signal} — shutting down`)
  if (heartbeatTimer)  clearInterval(heartbeatTimer)
  if (grpcServer) {
    await new Promise(resolve => grpcServer.tryShutdown(resolve))
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

main().catch(err => {
  console.error(`[Worker] Fatal startup error:`, err)
  process.exit(1)
})
