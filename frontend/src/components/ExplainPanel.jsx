import { useState } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

export default function ExplainPanel ({ sql, datasetId }) {
  const [plan,    setPlan]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [open,    setOpen]    = useState(false)

  async function handleExplain () {
    if (!sql || !datasetId) return
    setLoading(true)
    setError(null)
    setOpen(true)
    try {
      const res = await axios.post(`${API_URL}/api/explain`, { sql, datasetId })
      setPlan(res.data)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-4">
      <button
        onClick={handleExplain}
        disabled={loading || !datasetId}
        className="text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded-lg text-gray-300 transition-colors border border-gray-600"
      >
        {loading ? 'Explaining...' : '⚡ Explain Query'}
      </button>

      {open && (
        <div className="mt-3 bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs font-mono">
          <div className="flex justify-between items-center mb-3">
            <span className="text-blue-400 font-semibold text-sm">Execution Plan</span>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300">✕</button>
          </div>

          {error && <p className="text-red-400">{error}</p>}

          {plan && (
            <div className="space-y-3">
              {/* Dataset info */}
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400 mb-1">Dataset</div>
                <div className="text-gray-200">{plan.dataset.name} — {plan.dataset.total_rows?.toLocaleString()} rows → {plan.dataset.partition_count} partitions</div>
              </div>

              {/* Operation */}
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400 mb-1">Operation</div>
                <div className="text-green-400">{plan.execution_plan.operation}</div>
                <div className="text-gray-400 mt-1">~{plan.execution_plan.rows_per_worker?.toLocaleString()} rows/worker</div>
              </div>

              {/* Predicate pushdown */}
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400 mb-1">Predicate Pushdown</div>
                {plan.predicate_pushdown.predicates.length === 0
                  ? <div className="text-yellow-400">No WHERE clause — full scan</div>
                  : plan.predicate_pushdown.predicates.map((p, i) => (
                    <div key={i} className="text-green-300">
                      ✓ WHERE {p.column} {p.operator} {p.value} — <span className="text-gray-400">applied on worker before memory load</span>
                    </div>
                  ))
                }
              </div>

              {/* Aggregation */}
              {plan.aggregation.type !== 'NONE' && (
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-gray-400 mb-1">Partial Aggregation — GROUP BY {plan.aggregation.group_by.join(', ')}</div>
                  {plan.aggregation.functions.map((f, i) => (
                    <div key={i} className="text-gray-300">
                      <span className="text-purple-400">{f.function}({f.column})</span> as {f.alias}
                      <span className="text-gray-500 ml-2">→ worker: {f.worker_does}</span>
                    </div>
                  ))}
                  <div className="text-gray-500 mt-1 italic">{plan.aggregation.note}</div>
                </div>
              )}

              {/* ORDER BY + LIMIT */}
              {plan.ordering && (
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-gray-400 mb-1">ORDER BY</div>
                  <div className="text-gray-300">{plan.ordering.column} {plan.ordering.direction} — <span className="text-gray-500">{plan.ordering.applied_at}</span></div>
                </div>
              )}
              {plan.limit && (
                <div className="bg-gray-800 rounded p-2">
                  <div className="text-gray-400 mb-1">LIMIT</div>
                  <div className="text-gray-300">{plan.limit.value} rows — <span className="text-gray-500">{plan.limit.applied_at}</span></div>
                </div>
              )}

              {/* Partitions */}
              <div className="bg-gray-800 rounded p-2">
                <div className="text-gray-400 mb-1">Partition Assignment</div>
                {plan.partitions.map(p => (
                  <div key={p.index} className="text-gray-300">
                    {p.worker} → {p.minio_path} <span className="text-gray-500">({p.row_count?.toLocaleString()} rows)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
