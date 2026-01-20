'use strict'

// ─── OTel MUST be initialised before any other require ───────────────────────
// This file is loaded via: node -r ./tracing.js src/index.js

const { NodeSDK }            = require('@opentelemetry/sdk-node')
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus')
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node')

// PrometheusExporter is a METRIC READER — it starts its own HTTP server on
// port 9464 and exposes GET /metrics for Prometheus to scrape.
// Do NOT pass it to traceExporter.
const prometheusExporter = new PrometheusExporter({
  port: 9464,
  startServer: true
})

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || 'coordinator',
  metricReader: prometheusExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy fs instrumentation
      '@opentelemetry/instrumentation-fs': { enabled: false }
    })
  ]
})

sdk.start()
console.log('[OTel] SDK started — metrics on :9464/metrics')

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[OTel] SDK shut down'))
    .catch(err => console.error('[OTel] Shutdown error', err))
    .finally(() => process.exit(0))
})
