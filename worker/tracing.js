'use strict'

// OTel MUST be initialised before any other require
// Loaded via: node -r ./tracing.js src/index.js

const { NodeSDK }            = require('@opentelemetry/sdk-node')
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus')
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node')

const prometheusExporter = new PrometheusExporter({
  port: 9464,
  startServer: true
})

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || process.env.WORKER_ID || 'worker',
  metricReader: prometheusExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }
    })
  ]
})

sdk.start()
console.log('[OTel] Worker SDK started — metrics on :9464/metrics')

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[OTel] Worker SDK shut down'))
    .catch(err => console.error('[OTel] Shutdown error', err))
    .finally(() => process.exit(0))
})
