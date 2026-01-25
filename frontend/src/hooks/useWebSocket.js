import { useEffect, useRef, useCallback } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000'

/**
 * useWebSocket — connects to the coordinator WebSocket and subscribes to a job.
 * Calls onMessage for each server event.
 *
 * @param {string|null} jobId     - job to subscribe to (null = not subscribed)
 * @param {Function}    onMessage - called with each parsed event object
 */
export function useWebSocket (jobId, onMessage) {
  const wsRef       = useRef(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
    }

    const ws = new WebSocket(`${WS_URL}/ws`)

    ws.onopen = () => {
      if (jobId) {
        ws.send(JSON.stringify({ type: 'subscribe', jobId }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        onMessageRef.current(msg)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = (err) => {
      console.error('[WS] Error:', err)
    }

    ws.onclose = () => {
      console.log('[WS] Connection closed')
    }

    wsRef.current = ws
  }, [jobId])

  useEffect(() => {
    if (!jobId) return
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [jobId, connect])

  return { ws: wsRef.current }
}
