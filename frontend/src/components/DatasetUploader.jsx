import { useState, useRef } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

export default function DatasetUploader ({ onDatasetUploaded, datasets }) {
  const [uploading,   setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [dragOver,    setDragOver]    = useState(false)
  const fileInputRef = useRef(null)

  async function handleFile (file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Only CSV files are supported')
      return
    }

    setUploading(true)
    setUploadError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await axios.post(`${API_URL}/api/datasets/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: () => {}
      })
      onDatasetUploaded(res.data)
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message)
    } finally {
      setUploading(false)
    }
  }

  function onDrop (e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    handleFile(file)
  }

  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3 text-blue-400">1. Upload Dataset</h2>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-blue-400 bg-blue-900/20' : 'border-gray-600 hover:border-gray-400'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />
        {uploading
          ? <p className="text-gray-400 animate-pulse">Uploading and partitioning...</p>
          : <p className="text-gray-400">Drop CSV here or <span className="text-blue-400 underline">browse</span></p>
        }
      </div>

      {uploadError && (
        <p className="mt-2 text-red-400 text-sm">{uploadError}</p>
      )}

      {/* Existing datasets */}
      {datasets.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2">
          <p className="text-sm text-gray-500">Uploaded datasets:</p>
          {datasets.map(ds => (
            <div
              key={ds.id}
              className="bg-gray-800 rounded-lg p-3 text-sm flex justify-between items-center"
            >
              <div>
                <span className="font-medium text-gray-200">{ds.name}</span>
                <span className="ml-2 text-gray-500">{ds.row_count?.toLocaleString()} rows</span>
              </div>
              <span className="text-xs text-gray-600 font-mono">{ds.id.slice(0, 8)}...</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
