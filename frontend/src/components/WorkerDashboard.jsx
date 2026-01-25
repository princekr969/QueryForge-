import { useEffect, useState } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

const STATUS_COLORS = {
  idle:       'bg-gray-700 text-gray-300',
  processing: 'bg-yellow-700 text-yellow-200 animate-pulse',
  done:       'bg-green-800 text-green-200',
  dead:       'bg-red-900 text-red-300',
  unknown:    'bg-gray-800 text-gray-500'
}

export default function WorkerDashboard ({ progress }) {
  const [workers, setWorkers] = useState([])

  // Poll worker status every 3 s
  useEffect(() => {
    async function fetchWorkers () {
      try {
        const res = await axios.get(`${API_URL}/api/workers`)
        setWorkers(res.data)
      } catch {
        // ignore network errors during polling
      }
    }

    fetchWorkers()
    const id = setInterval(fetchWorkers, 3000)
    return () => clearInterval(id)
  }, [])

  const completedTasks = progress?.completedTasks ?? 0
  const totalTasks     = progress?.totalTasks     ?? 0

  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3 text-blue-400">3. Worker Status</h2>

      {/* Progress bar */}
      {totalTasks > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-400 mb-1">
            <span>Tasks: {completedTasks} / {totalTasks} complete</span>
            <span>{Math.round((completedTasks / totalTasks) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${(completedTasks / totalTasks) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Worker cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {workers.length === 0
          ? ['worker-1', 'worker-2', 'worker-3'].map(id => (
              <WorkerCard key={id} worker={{ id, liveStatus: 'unknown', activeTasks: 0 }} />
            ))
          : workers.map(w => <WorkerCard key={w.id} worker={w} />)
        }
      </div>
    </section>
  )
}

function WorkerCard ({ worker }) {
  const status     = worker.liveStatus || 'unknown'
  const colorClass = STATUS_COLORS[status] || STATUS_COLORS.unknown

  return (
    <div className={`rounded-xl p-4 border border-gray-700 ${colorClass}`}>
      <div className="font-semibold text-base">{worker.id}</div>
      <div className="mt-1 text-sm capitalize">{status}</div>
      {worker.activeTasks > 0 && (
        <div className="mt-1 text-xs opacity-75">{worker.activeTasks} active task(s)</div>
      )}
      {worker.last_heartbeat && (
        <div className="mt-1 text-xs opacity-50">
          Last seen: {new Date(worker.last_heartbeat).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
