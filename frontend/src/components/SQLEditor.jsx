import { useState } from 'react'
import ExplainPanel from './ExplainPanel'

const EXAMPLE_QUERIES = [
  {
    label: 'GROUP BY + AVG',
    sql: 'SELECT department, COUNT(*) as total, AVG(salary) as avg_salary\nFROM employees\nWHERE age > 25\nGROUP BY department\nORDER BY total DESC'
  },
  {
    label: 'Filtered scan',
    sql: 'SELECT name, salary, city\nFROM employees\nWHERE salary > 60000\nORDER BY salary DESC\nLIMIT 20'
  },
  {
    label: 'SUM by group',
    sql: 'SELECT department, SUM(salary) as total_salary\nFROM employees\nWHERE age > 30\nGROUP BY department'
  },
]

const KEYBOARD_HINT = navigator.platform?.includes('Mac') ? '⌘↵' : 'Ctrl+↵'

export default function SQLEditor ({ datasets, onRunQuery, loading }) {
  const [sql,         setSql]         = useState(EXAMPLE_QUERIES[0].sql)
  const [datasetId,   setDatasetId]   = useState('')
  const [showExplain, setShowExplain] = useState(false)

  function handleRun () {
    if (!sql.trim()) return
    if (!datasetId) return
    onRunQuery(sql.trim(), datasetId)
  }

  function handleKeyDown (e) {
    // Ctrl/Cmd + Enter → run
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
    // Tab → insert 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = e.target.selectionStart
      const end   = e.target.selectionEnd
      const next  = sql.substring(0, start) + '  ' + sql.substring(end)
      setSql(next)
      requestAnimationFrame(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 2
      })
    }
  }

  const canRun = !!sql.trim() && !!datasetId && !loading
  const selectedDataset = datasets.find(d => d.id === datasetId)

  return (
    <div className="card-glow flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-danger/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-warn/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
          </div>
          <span className="text-xs text-ink-faint font-mono ml-1">query.sql</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge-ghost">SQL</span>
          {loading && (
            <div className="flex items-center gap-1.5 text-xs text-warn-text">
              <span className="status-dot bg-warn animate-pulse-dot" />
              Executing...
            </div>
          )}
        </div>
      </div>

      {/* ── Dataset selector ────────────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-border bg-surface/50">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" className="text-ink-faint flex-shrink-0">
            <ellipse cx="6.5" cy="4" rx="5" ry="2" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M1.5 4v5c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M1.5 6.5c0 1.1 2.24 2 5 2s5-.9 5-2" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          <select
            value={datasetId}
            onChange={e => setDatasetId(e.target.value)}
            className="input-select py-1.5 text-xs"
          >
            <option value="">Select a dataset to query…</option>
            {datasets.map(ds => (
              <option key={ds.id} value={ds.id}>
                {ds.name} · {ds.row_count?.toLocaleString() ?? '?'} rows
              </option>
            ))}
          </select>
          {selectedDataset && (
            <span className="badge-blue flex-shrink-0 text-[10px]">
              {selectedDataset.partition_count ?? 3} partitions
            </span>
          )}
        </div>
      </div>

      {/* ── SQL textarea ─────────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        {/* Line numbers gutter */}
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-10 border-r border-border/50 bg-surface/30 text-right py-3.5 pr-2 text-[10px] font-mono text-ink-ghost leading-relaxed select-none pointer-events-none"
          style={{ lineHeight: '1.625rem' }}
        >
          {sql.split('\n').map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        <textarea
          value={sql}
          onChange={e => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={Math.max(6, sql.split('\n').length + 1)}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="sql-editor rounded-none border-none ring-0 focus:ring-0 pl-14 pr-4 py-3.5 w-full h-full min-h-[180px]"
          placeholder="SELECT * FROM your_table WHERE …"
          style={{ lineHeight: '1.625rem' }}
        />
      </div>

      {/* ── Example queries ───────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-border/50 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-ink-ghost uppercase tracking-wider font-medium">Examples:</span>
        {EXAMPLE_QUERIES.map((eq, i) => (
          <button
            key={i}
            onClick={() => setSql(eq.sql)}
            className="text-[10px] px-2 py-1 bg-surface hover:bg-card border border-border hover:border-navy rounded-md text-ink-muted hover:text-ink transition-all duration-100"
          >
            {eq.label}
          </button>
        ))}
      </div>

      {/* ── Actions ──────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3">
        {/* Explain */}
        <button
          onClick={() => setShowExplain(v => !v)}
          disabled={!datasetId || !sql.trim()}
          className="btn-ghost text-xs py-2 gap-1.5"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 3h9M2 6.5h6M2 10h7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <circle cx="10.5" cy="10" r="2" stroke="currentColor" strokeWidth="1"/>
          </svg>
          {showExplain ? 'Hide' : 'Explain'}
        </button>

        {/* Run */}
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="btn-primary flex-1 sm:flex-none sm:min-w-[140px]"
        >
          {loading ? (
            <>
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/>
                <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Running…
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M3 2.5l7 4-7 4V2.5z" fill="currentColor"/>
              </svg>
              Run Query
              <span className="ml-auto text-[10px] opacity-50 font-mono hidden sm:block">{KEYBOARD_HINT}</span>
            </>
          )}
        </button>
      </div>

      {/* ── Explain panel ─────────────────────────────────────── */}
      {showExplain && (
        <div className="border-t border-border">
          <ExplainPanel sql={sql} datasetId={datasetId} autoFetch={showExplain} />
        </div>
      )}
    </div>
  )
}
