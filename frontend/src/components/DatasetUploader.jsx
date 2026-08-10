import { useState, useRef } from 'react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_COORDINATOR_URL || 'http://localhost:3000'

export default function DatasetUploader ({ onDatasetUploaded, datasets }) {
  const [uploading,    setUploading]    = useState(false)
  const [uploadError,  setUploadError]  = useState(null)
  const [uploadDone,   setUploadDone]   = useState(null)   // { name, rowCount }
  const [dragOver,     setDragOver]     = useState(false)
  const [uploadPct,    setUploadPct]    = useState(0)
  const fileInputRef = useRef(null)

  async function handleFile (file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Only .csv files are supported')
      return
    }
    setUploading(true)
    setUploadError(null)
    setUploadDone(null)
    setUploadPct(0)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await axios.post(`${API_URL}/api/datasets/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => {
          if (e.total) setUploadPct(Math.round((e.loaded / e.total) * 100))
        }
      })
      setUploadDone({ name: res.data.name || file.name, rowCount: res.data.rowCount })
      onDatasetUploaded(res.data)
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message)
    } finally {
      setUploading(false)
      setUploadPct(0)
    }
  }

  function onDrop (e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  const formatRows = n => n ? n.toLocaleString() : '?'
  const formatDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''

  return (
    <div className="space-y-5">
      {/* Upload zone */}
      <div
        onDrop={onDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !uploading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && !uploading && fileInputRef.current?.click()}
        aria-label="Upload CSV dataset"
        className={`
          relative group flex flex-col items-center justify-center
          min-h-[180px] rounded-xl border-2 border-dashed
          cursor-pointer transition-all duration-200 overflow-hidden
          ${dragOver
            ? 'border-accent bg-accent/5 shadow-glow'
            : uploading
              ? 'border-warn/40 bg-warn/5 cursor-default'
              : uploadDone
                ? 'border-success/40 bg-success-dim cursor-pointer'
                : 'border-border hover:border-navy hover:bg-card/50'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => handleFile(e.target.files[0])}
        />

        {/* Upload progress bar */}
        {uploading && uploadPct > 0 && (
          <div className="absolute bottom-0 left-0 h-0.5 bg-warn/40 transition-all duration-200" style={{ width: `${uploadPct}%` }} />
        )}

        {uploading ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="relative w-10 h-10">
              <svg className="animate-spin" width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="16" stroke="#293049" strokeWidth="2"/>
                <path d="M20 4A16 16 0 0 1 36 20" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-warn-text">Uploading & partitioning…</p>
              {uploadPct > 0 && <p className="text-xs text-ink-faint mt-0.5">{uploadPct}%</p>}
            </div>
          </div>
        ) : uploadDone ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="w-10 h-10 rounded-full bg-success-dim border border-success/30 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M4 9l3.5 3.5L14 6" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-success-text">{uploadDone.name}</p>
              <p className="text-xs text-ink-faint mt-0.5">{formatRows(uploadDone.rowCount)} rows uploaded</p>
            </div>
            <span className="text-[10px] text-ink-ghost">Click to upload another</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 px-6 text-center">
            <div className={`
              w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-200
              ${dragOver ? 'bg-accent/15 border-accent/30' : 'bg-card border-border group-hover:border-navy'}
            `}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M11 14V4M7 8l4-4 4 4" stroke={dragOver ? '#3b82f6' : '#8892a4'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 15v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke={dragOver ? '#3b82f6' : '#4a5568'} strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-ink">
                {dragOver ? 'Drop CSV to upload' : (
                  <>Drop CSV here or <span className="text-accent underline underline-offset-2">browse</span></>
                )}
              </p>
              <p className="text-xs text-ink-faint mt-1">Partitioned across 3 workers automatically · Max 1 GB</p>
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {uploadError && (
        <div className="flex items-start gap-2.5 p-3.5 bg-danger-dim border border-danger/20 rounded-lg text-xs text-danger-text animate-fade-in">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-0.5 flex-shrink-0">
            <circle cx="7" cy="7" r="6" stroke="#ef4444" strokeWidth="1.2"/>
            <path d="M7 4v3.5M7 9.5v.5" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          {uploadError}
        </div>
      )}

      {/* Dataset library */}
      {datasets.length > 0 && (
        <div>
          <div className="section-label">Dataset Library</div>
          <div className="space-y-2">
            {datasets.map(ds => (
              <div
                key={ds.id}
                className="card flex items-center justify-between px-4 py-3 hover:border-navy/80 transition-colors duration-150"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/15 flex items-center justify-center flex-shrink-0">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <ellipse cx="7" cy="4.5" rx="4.5" ry="1.8" stroke="#3b82f6" strokeWidth="1.2"/>
                      <path d="M2.5 4.5v5c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8v-5" stroke="#3b82f6" strokeWidth="1.2"/>
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{ds.name}</p>
                    <p className="text-[10px] text-ink-faint">
                      {formatRows(ds.row_count)} rows
                      {ds.created_at && ` · ${formatDate(ds.created_at)}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="badge-ghost text-[10px]">{ds.partition_count ?? 3}p</span>
                  <span className="font-mono text-[9px] text-ink-ghost">{ds.id.slice(0, 8)}…</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {datasets.length === 0 && !uploading && (
        <div className="text-center py-6">
          <p className="text-xs text-ink-faint">No datasets yet. Upload a CSV to get started.</p>
        </div>
      )}
    </div>
  )
}
