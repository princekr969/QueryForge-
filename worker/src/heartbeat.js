'use strict'

const { sendHeartbeat } = require('./grpc/coordinatorClient')

const HEARTBEAT_INTERVAL_MS = 5_000

let activeTasks = 0

function incrementActiveTasks () { activeTasks++ }
function decrementActiveTasks () { if (activeTasks > 0) activeTasks-- }

/**
 * Start heartbeat loop. Returns the interval ID so caller can clear it on shutdown.
 */
function startHeartbeat (workerId) {
  console.log(`[Heartbeat] Starting for ${workerId} every ${HEARTBEAT_INTERVAL_MS}ms`)

  const interval = setInterval(async () => {
    try {
      await sendHeartbeat(workerId, activeTasks)
    } catch (err) {
      console.warn(`[Heartbeat] Failed: ${err.message}`)
    }
  }, HEARTBEAT_INTERVAL_MS)

  return interval
}

module.exports = { startHeartbeat, incrementActiveTasks, decrementActiveTasks }
