import { useState, useEffect } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

const OP_COLOR = {
  DISTRIBUTED_AGGREGATE: 'text-accent',
  DISTRIBUTED_SCAN:      'text-warn-text',
}

export default function ExplainPanel ({ sql, datasetId, autoFetch }) {
  const [plan,    setPlan]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    if (autoFetch && sql && datasetId) fetchPlan()
  }, [autoFetch, sql, datasetId])

  async function fetchPlan () {
    if (!sql || !datasetId) return
    setLoading(true)
    setError(null)
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
    <div className="bg-surface/60">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M1.5 6.5h10M6.5 1.5v10" stroke="#8892a4" strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="6.5" cy="6.5" r="5" stroke="#8892a4" strokeWidth="1.2"/>
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Execution Plan</span>
        </div>
        <button onClick={fetchPlan} disabled={loading} className="btn-ghost py-1 px-2 text-[10px]">
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="px-4 py-6 flex items-center justify-center gap-2">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="#293049" strokeWidth="1.5"/>
            <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span className="text-xs text-ink-faint">Analyzing query…</span>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 text-xs text-danger-text">{error}</div>
      )}

      {plan && !loading && (
        <div className="p-4 space-y-3 text-xs font-mono">
          {/* Dataset */}
          <PlanBlock
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <ellipse cx="6" cy="3.5" rx="4" ry="1.5" stroke="#8892a4" strokeWidth="1"/>
                <path d="M2 3.5v5c0 .83 1.79 1.5 4 1.5s4-.67 4-1.5v-5" stroke="#8892a4" strokeWidth="1"/>
              </svg>
            }
            label="Source"
          >
            <span className="text-ink">{plan.dataset.name}</span>
            <span className="text-ink-faint ml-2">{plan.dataset.total_rows?.toLocaleString()} rows</span>
            <span className="text-ink-ghost ml-2">→</span>
            <span className="text-accent ml-2">{plan.dataset.partition_count} partitions</span>
          </PlanBlock>

          {/* Operation */}
          <PlanBlock
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6h8M6 2v8" stroke="#8892a4" strokeWidth="1" strokeLinecap="round"/>
                <circle cx="6" cy="6" r="4.5" stroke="#8892a4" strokeWidth="1"/>
              </svg>
            }
            label="Operation"
          >
            <span className={`font-semibold ${OP_COLOR[plan.execution_plan.operation] || 'text-ink'}`}>
              {plan.execution_plan.operation}
            </span>
            <span className="text-ink-faint ml-3">~{plan.execution_plan.rows_per_worker?.toLocaleString()} rows/worker</span>
          </PlanBlock>

          {/* Predicates */}
          <PlanBlock
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 3h8M3.5 6h5M5 9h2" stroke="#8892a4" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            }
            label="Predicate Pushdown"
          >
            {plan.predicate_pushdown.predicates.length === 0 ? (
              <span className="text-warn-text">Full scan — no WHERE predicates</span>
            ) : (
              <div className="flex flex-wrap gap-2 mt-0.5">
                {plan.predicate_pushdown.predicates.map((p, i) => (
                  <span key={i} className="badge-green py-0.5">
                    {p.column} {p.operator} {p.value}
                  </span>
                ))}
              </div>
            )}
          </PlanBlock>

          {/* Aggregation */}
          {plan.aggregation.type !== 'NONE' && (
            <PlanBlock
              icon={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2h3v3H2zM7 2h3v3H7zM2 7h3v3H2zM7 7h3v3H7z" stroke="#8892a4" strokeWidth="1"/>
                </svg>
              }
              label={`Partial Aggregation · GROUP BY ${plan.aggregation.group_by?.join(', ')}`}
            >
              <div className="space-y-1 mt-0.5">
                {plan.aggregation.functions?.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-accent font-semibold">{f.function}({f.column})</span>
                    <span className="text-ink-ghost">→</span>
                    <span className="text-ink">{f.alias}</span>
                    <span className="text-ink-ghost">·</span>
                    <span className="text-ink-faint">{f.worker_does}</span>
                  </div>
                ))}
                {plan.aggregation.note && (
                  <p className="text-ink-ghost italic text-[10px] mt-1">{plan.aggregation.note}</p>
                )}
              </div>
            </PlanBlock>
          )}

          {/* ORDER BY */}
          {plan.ordering && (
            <PlanBlock
              icon={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 3h8M3 6h5M4 9h3" stroke="#8892a4" strokeWidth="1" strokeLinecap="round"/>
                </svg>
              }
              label="ORDER BY"
            >
              <span className="text-ink">{plan.ordering.column}</span>
              <span className="text-ink-faint ml-2">{plan.ordering.direction}</span>
              <span className="text-ink-ghost ml-2">· {plan.ordering.applied_at}</span>
            </PlanBlock>
          )}

          {/* LIMIT */}
          {plan.limit && (
            <PlanBlock
              icon={
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2v8h8" stroke="#8892a4" strokeWidth="1" strokeLinecap="round"/>
                  <path d="M4 8V5M6 8V3M8 8V6" stroke="#8892a4" strokeWidth="1" strokeLinecap="round"/>
                </svg>
              }
              label="LIMIT"
            >
              <span className="text-ink">{plan.limit.value} rows</span>
              <span className="text-ink-ghost ml-2">· {plan.limit.applied_at}</span>
            </PlanBlock>
          )}

          {/* Partition assignment */}
          <PlanBlock
            icon={
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="#8892a4" strokeWidth="1"/>
                <path d="M3.5 6a2.5 2.5 0 0 1 5 0" stroke="#8892a4" strokeWidth="1"/>
              </svg>
            }
            label="Partition Assignment"
          >
            <div className="grid grid-cols-1 gap-1 mt-0.5">
              {plan.partitions?.map(p => (
                <div key={p.index} className="flex items-center gap-2">
                  <span className="badge-blue py-0.5 text-[9px]">{p.worker}</span>
                  <span className="text-ink-ghost truncate max-w-[180px]">{p.minio_path}</span>
                  <span className="text-ink-faint flex-shrink-0">{p.row_count?.toLocaleString()} rows</span>
                </div>
              ))}
            </div>
          </PlanBlock>
        </div>
      )}
    </div>
  )
}

function PlanBlock ({ icon, label, children }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-5 h-5 rounded bg-card border border-border flex items-center justify-center mt-0.5">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] text-ink-ghost uppercase tracking-widest mb-0.5 font-medium">{label}</div>
        <div className="flex flex-wrap items-center gap-1 text-[11px]">{children}</div>
      </div>
    </div>
  )
}
