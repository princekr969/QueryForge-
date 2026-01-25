import { useRef } from 'react'

export default function ResultsTable ({ rows, columns, complete, executionTimeMs }) {
  const tableRef = useRef(null)

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
    a.download = 'dataforge_results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0 && !complete) return null

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold text-blue-400">4. Results</h2>
        <div className="flex items-center gap-4">
          {complete && (
            <span className="text-sm text-gray-400">
              {rows.length.toLocaleString()} rows
              {executionTimeMs ? ` · ${executionTimeMs}ms` : ''}
            </span>
          )}
          {rows.length > 0 && (
            <button
              onClick={exportCsv}
              className="text-sm px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 transition-colors"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 && complete ? (
        <p className="text-gray-500 text-sm">Query returned no results.</p>
      ) : (
        <div ref={tableRef} className="overflow-x-auto rounded-xl border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800 text-gray-400">
              <tr>
                {columns.map(col => (
                  <th key={col} className="px-4 py-2 text-left font-medium whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className={i % 2 === 0 ? 'bg-gray-900' : 'bg-gray-950'}
                >
                  {columns.map(col => {
                    const val = row[col]
                    let display
                    if (val === undefined || val === null || val === '') {
                      display = <span className="text-gray-600">null</span>
                    } else {
                      // Values arrive as strings from proto — attempt numeric formatting
                      const num = Number(val)
                      if (!isNaN(num) && val !== '') {
                        display = Number.isInteger(num)
                          ? num.toLocaleString()
                          : num.toFixed(2)
                      } else {
                        display = String(val)
                      }
                    }
                    return (
                      <td key={col} className="px-4 py-2 text-gray-300 whitespace-nowrap font-mono text-xs">
                        {display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
