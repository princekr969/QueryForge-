import { useState } from 'react'
import ExplainPanel from './ExplainPanel'

const EXAMPLE_QUERIES = [
  {
    label: 'GROUP BY aggregation',
    sql: 'SELECT department, COUNT(*) as total, AVG(salary) as avg_salary FROM employees WHERE age > 25 GROUP BY department ORDER BY total DESC'
  },
  {
    label: 'Filtered scan',
    sql: 'SELECT name, salary, city FROM employees WHERE salary > 60000 ORDER BY salary DESC LIMIT 20'
  },
  {
    label: 'SUM by group',
    sql: 'SELECT department, SUM(salary) as total_salary FROM employees WHERE age > 30 GROUP BY department'
  }
]

export default function SQLEditor ({ datasets, onRunQuery, loading }) {
  const [sql,       setSql]       = useState(EXAMPLE_QUERIES[0].sql)
  const [datasetId, setDatasetId] = useState('')

  function handleRun () {
    if (!sql.trim()) return
    if (!datasetId)  { alert('Please select a dataset'); return }
    onRunQuery(sql.trim(), datasetId)
  }

  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3 text-blue-400">2. Write SQL</h2>

      {/* Dataset selector */}
      <select
        value={datasetId}
        onChange={e => setDatasetId(e.target.value)}
        className="w-full mb-3 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-gray-200 focus:outline-none focus:border-blue-500"
      >
        <option value="">— Select a dataset —</option>
        {datasets.map(ds => (
          <option key={ds.id} value={ds.id}>
            {ds.name} ({ds.row_count?.toLocaleString()} rows)
          </option>
        ))}
      </select>

      {/* SQL textarea */}
      <textarea
        value={sql}
        onChange={e => setSql(e.target.value)}
        rows={5}
        spellCheck={false}
        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-green-300 focus:outline-none focus:border-blue-500 resize-none"
        placeholder="SELECT * FROM your_table WHERE ..."
      />

      {/* Example queries */}
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((eq, i) => (
          <button
            key={i}
            onClick={() => setSql(eq.sql)}
            className="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-gray-300 transition-colors"
          >
            {eq.label}
          </button>
        ))}
      </div>

      {/* Explain panel — shows execution plan before running */}
      <div className="mt-3">
        <ExplainPanel sql={sql} datasetId={datasetId} />
      </div>

      <button
        onClick={handleRun}
        disabled={loading}
        className="mt-2 w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 rounded-xl font-semibold transition-colors"
      >
        {loading ? 'Running...' : 'Run Query'}
      </button>
    </section>
  )
}
