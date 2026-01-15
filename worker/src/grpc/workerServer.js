'use strict'

const grpc        = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const path        = require('path')
const { executeTask } = require('../services/taskExecutor')

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

/**
 * ExecuteTask — server-side streaming RPC.
 * call.end() is ALWAYS called in finally — coordinator hangs if omitted.
 */
async function executeTaskRpc (call) {
  const request = call.request
  console.log(`[Worker] ExecuteTask — task ${request.task_id}, partition: ${request.partition_path}`)

  try {
    await executeTask(request, (partialResult) => {
      call.write(partialResult)
    })
    console.log(`[Worker] ExecuteTask complete — task ${request.task_id}`)
  } catch (err) {
    console.error(`[Worker] ExecuteTask error — task ${request.task_id}:`, err.message)
  } finally {
    // CRITICAL: always call end() so coordinator's call.on('end') fires
    try { call.end() } catch {}
  }
}

function ping (call, callback) {
  callback(null, { alive: true })
}

function startWorkerGrpcServer (port) {
  const server = new grpc.Server()

  server.addService(proto.WorkerService.service, {
    ExecuteTask: executeTaskRpc,
    Ping:        ping
  })

  return new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) return reject(err)
        console.log(`[Worker] gRPC WorkerService listening on port ${boundPort}`)
        resolve(server)
      }
    )
  })
}

module.exports = { startWorkerGrpcServer }
