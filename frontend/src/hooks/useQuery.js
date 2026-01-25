import { useState, useCallback } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

/**
 * useQuery — submits a SQL query and tracks job state.
 */
export function useQuery () {
  const [jobId,    setJobId]    = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  const submitQuery = useCallback(async (sql, datasetId) => {
    setLoading(true)
    setError(null)
    setJobId(null)

    try {
      const response = await axios.post(`${API_URL}/api/query`, { sql, datasetId })
      setJobId(response.data.jobId)
      return response.data.jobId
    } catch (err) {
      const msg = err.response?.data?.error || err.message
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { jobId, loading, error, submitQuery }
}
