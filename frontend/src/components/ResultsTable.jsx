import { useRef, useState } from 'react'

export default function ResultsTable ({ rows, columns, complete, executionTimeMs, loading }) {
  const tableRef   = useRef(null)
  const [sortCol,  setSortCol]  = useState(null)
  const [sortDir,  setSortDir]  = useState('asc')
  const [search,   setSearch]   = useState('')

  function handleSort (col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  function exportCsv () {
    if (rows.length === 0 || columns.length === 0) return
    const header = columns.join(',')
    const body   = rows.map(row =>
      columns.map(col => {
        const val = String(row[col] ?? '')
        return val.includes(',') ? `"${val}"` : val
      }).join(',')
    ).join('\n')
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'queryforge_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function formatVal (val) {
    if (val === undefined || val === null || val === '') return null
    const num = Number(val)
    if (!isNaN(num) && String(val).trim() !== '') {
      return Number.isInteger(num) ? num.toLocaleString() : num.toFixed(2)
    }
    return String(val)
  }

  // Filter
  const filtered = search.trim()
    ? rows.filter(row =>
        columns.some(col => String(row[col] ?? '').toLowerCase().includes(search.toLowerCase()))
      )
    : rows

  // Sort
  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol]
        const an = Number(av), bn = Number(bv)
        if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an
        return sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av))
      })
    : filtered

  if (rows.length === 0 && complete && !loading) {
    return (
      <div className="card-glow p-8 text-center animate-fade-in">
        <p className="text-ink-muted text-sm">Query returned no results.</p>
      </div>
    )
  }

  if (rows.length === 0) return null

  return (
    <div className="card-glow flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="12" height="12" rx="2" stroke="#8892a4" strokeWidth="1.2"/>
              <path d="M1 5h12M5 5v7" stroke="#8892a4" strokeWidth="1.2"/>
            </svg>
            <span className="text-xs font-semibold text-ink">Results</span>
          </div>
          {/* Live indicator while streaming */}
          {loading && (
            <div className="flex items-center gap-1.5">
              <span className="status-dot bg-accent animate-pulse" />
              <span className="text-[10px] text-accent">Streaming…</span>
            </div>
          )}
          {complete && !loading && (
            <span className="badge-green text-[10px]">Complete</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Stats */}
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-ink-faint font-mono">
            <span>{rows.length.toLocaleString()} rows</span>
            {columns.length > 0 && <span>{columns.length} cols</span>}
            {executionTimeMs != null && (
              <span className="text-accent">{executionTimeMs.toLocaleString()}ms</span>
            )}
          </div>
          {/* Export */}
          <button onClick={exportCsv} className="btn-ghost text-xs py-1.5 gap-1">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v7M3 5.5L6 8l3-2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M1 9v1.5A.5.5 0 0 0 1.5 11h9a.5.5 0 0 0 .5-.5V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* Search bar */}
      {rows.length > 5 && (
        <div className="px-4 py-2 border-b border-border/50">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Filter results…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-base py-1.5 pl-8 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
          {search && (
            <p className="text-[10px] text-ink-faint mt-1">
              {sorted.length.toLocaleString()} of {rows.length.toLocaleString()} rows match
            </p>
          )}
        </div>
      )}

      {/* Table */}
      <div ref={tableRef} className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface/60">
              <th className="px-4 py-2.5 text-left text-[10px] font-medium text-ink-ghost w-10 select-none">#</th>
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className="px-4 py-2.5 text-left font-medium text-ink-faint whitespace-nowrap cursor-pointer hover:text-ink transition-colors group select-none"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider">{col}</span>
                    <span className={`transition-opacity ${sortCol === col ? 'opacity-100 text-accent' : 'opacity-0 group-hover:opacity-40'}`}>
                      {sortCol === col && sortDir === 'desc' ? '↓' : '↑'}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={i}
                className={`
                  border-b border-border/30 transition-colors duration-75 hover:bg-card/60
                  ${i % 2 === 0 ? 'bg-transparent' : 'bg-surface/30'}
                `}
              >
                <td className="px-4 py-2.5 text-ink-ghost font-mono select-none">{i + 1}</td>
                {columns.map(col => {
                  const raw = row[col]
                  const formatted = formatVal(raw)
                  const isNull = formatted === null
                  const isNum  = !isNull && !isNaN(Number(raw)) && String(raw).trim() !== ''
                  return (
                    <td
                      key={col}
                      className={`
                        px-4 py-2.5 whitespace-nowrap
                        ${isNull  ? 'text-ink-ghost italic'         : ''}
                        ${isNum   ? 'font-mono text-ink tabular-nums' : 'text-ink-muted'}
                      `}
                    >
                      {isNull ? 'null' : formatted}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-surface/30">
        <span className="text-[10px] text-ink-ghost font-mono">
          {sorted.length < rows.length
            ? `Showing ${sorted.length.toLocaleString()} of ${rows.length.toLocaleString()} rows`
            : `${rows.length.toLocaleString()} row${rows.length !== 1 ? 's' : ''}`
          }
        </span>
        {executionTimeMs != null && (
          <span className="text-[10px] font-mono text-ink-ghost">
            <span className="text-accent">{executionTimeMs.toLocaleString()}ms</span>
            {' '}· ~{Math.round(rows.length / (executionTimeMs / 1000)).toLocaleString()} rows/s
          </span>
        )}
      </div>
    </div>
  )
}
