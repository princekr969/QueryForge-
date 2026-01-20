'use strict'

const grpc        = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const path        = require('path')

const PROTO_PATH = process.env.PROTO_PATH ||
  (require('fs').existsSync('/proto/dataforge.proto')
    ? '/proto/dataforge.proto'
    : path.join(__dirname, '../../../../proto/dataforge.proto'))

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs:    String,
  enums:    String,
  defaults: true,
  oneofs:   true
})

const proto = grpc.loadPackageDefinition(packageDef).dataforge

// Cache of worker stubs keyed by "host:port"
const stubCache = new Map()

/**
 * Get or create a gRPC stub for a worker address.
 * Uses WAIT_FOR_READY so transient connection issues don't immediately fail.
 */
function getWorkerStub (address) {
  if (!stubCache.has(address)) {
    const stub = new proto.WorkerService(
      address,
      grpc.credentials.createInsecure(),
      {
        'grpc.wait_for_ready': 1  // retry connecting instead of failing immediately
      }
    )
    stubCache.set(address, stub)
  }
  return stubCache.get(address)
}

/**
 * Invalidate a cached stub (call when a worker is known to have restarted).
 */
function invalidateWorkerStub (address) {
  const stub = stubCache.get(address)
  if (stub) {
    try { stub.close() } catch {}
    stubCache.delete(address)
  }
}

/**
 * Execute a task on a remote worker via server-side streaming.
 * Resolves with array of all PartialResult messages received.
 */
function executeTaskOnWorker (workerAddress, taskRequest) {
  return new Promise((resolve, reject) => {
    const stub    = getWorkerStub(workerAddress)
    const results = []

    const deadline = new Date(Date.now() + 30_000)
    const call     = stub.ExecuteTask(taskRequest, { deadline })

    call.on('data',  (partialResult) => results.push(partialResult))
    call.on('end',   ()              => resolve(results))
    call.on('error', (err)           => reject(err))
  })
}

/**
 * Ping a worker — returns true if alive within 3 seconds.
 */
function pingWorker (workerAddress) {
  return new Promise((resolve) => {
    const stub = getWorkerStub(workerAddress)
    stub.Ping({}, { deadline: Date.now() + 3000 }, (err, response) => {
      resolve(!err && response && response.alive === true)
    })
  })
}

module.exports = { executeTaskOnWorker, pingWorker, getWorkerStub, invalidateWorkerStub }
