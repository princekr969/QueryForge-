import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

import DatasetUploader from './components/DatasetUploader'
import SQLEditor       from './components/SQLEditor'
import WorkerDashboard from './components/WorkerDashboard'
import ResultsTable    from './components/ResultsTable'
import { useQuery }    from './hooks/useQuery'
import { useWebSocket } from './hooks/useWebSocket'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

export default function App () {
  const [datasets,        setDatasets]        = useState([])
  const [rows,            setRows]            = useState([])
  const [columns,         setColumns]         = useState([])
  const [progress,        setProgress]        = useState(null)
  const [queryComplete,   setQueryComplete]   = useState(false)
  const [executionTimeMs, setExecutionTimeMs] = useState(null)

  const { jobId, loading, error, submitQuery } = useQuery()

  // Fetch existing datasets on mount
  useEffect(() => {
    axios.get(`${API_URL}/api/datasets`)
      .then(res => setDatasets(res.data))
      .catch(() => {})
  }, [])

  // Handle incoming WebSocket events
  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'row') {
      setRows(prev => {
        // Derive column list from first row — set outside updater to avoid batching issues
        return [...prev, msg.data]
      })
      // Set columns from first row only (idempotent after first call)
      setColumns(prev => prev.length === 0 ? Object.keys(msg.data) : prev)
    } else if (msg.type === 'progress') {
      setProgress({ completedTasks: msg.completedTasks, totalTasks: msg.totalTasks })
    } else if (msg.type === 'complete') {
      setQueryComplete(true)
      setExecutionTimeMs(msg.executionTimeMs)
    } else if (msg.type === 'error') {
      console.error('[WS] Query error:', msg.message)
      setQueryComplete(true)  // stop loading state
    }
  }, [])

  useWebSocket(jobId, handleWsMessage)

  async function handleRunQuery (sql, datasetId) {
    // Reset state before new query
    setRows([])
    setColumns([])
    setProgress(null)
    setQueryComplete(false)
    setExecutionTimeMs(null)

    await submitQuery(sql, datasetId)
  }

  function handleDatasetUploaded (data) {
    // Refresh dataset list
    axios.get(`${API_URL}/api/datasets`)
      .then(res => setDatasets(res.data))
      .catch(() => {})
    console.log('Uploaded dataset:', data)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <div className="text-2xl font-bold text-blue-400">DataForge</div>
        <div className="text-gray-500 text-sm">Distributed SQL Engine</div>
        <div className="ml-auto text-xs text-gray-600">
          Inspired by AWS Athena · BigQuery
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Section 1 — Upload */}
        <DatasetUploader
          datasets={datasets}
          onDatasetUploaded={handleDatasetUploaded}
        />

        {/* Section 2 — SQL Editor */}
        <SQLEditor
          datasets={datasets}
          onRunQuery={handleRunQuery}
          loading={loading}
        />

        {error && (
          <div className="mb-6 p-3 bg-red-900/40 border border-red-700 rounded-xl text-red-300 text-sm">
            Error: {error}
          </div>
        )}

        {/* Section 3 — Worker dashboard */}
        {(jobId || rows.length > 0) && (
          <WorkerDashboard progress={progress} />
        )}

        {/* Section 4 — Results */}
        <ResultsTable
          rows={rows}
          columns={columns}
          complete={queryComplete}
          executionTimeMs={executionTimeMs}
        />
      </main>
    </div>
  )
}
