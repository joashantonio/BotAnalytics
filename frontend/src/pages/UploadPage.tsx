import { useRef, type DragEvent, type ChangeEvent } from 'react'
import type { PrefetchStatusResponse, SessionInfo, UploadResponse } from '../types'

interface Props {
  uploading: boolean
  error: string | null
  session: UploadResponse | null
  sessions: SessionInfo[]
  suffix: string
  onSuffixChange: (s: string) => void
  onUpload: (files: File | File[]) => void
  onClear: () => void
  onSelectSession: (sessionId: string) => void
  onDeleteSession: (sessionId: string) => void
  prefetchStatus: PrefetchStatusResponse | null
}

export default function UploadPage({
  uploading,
  error,
  session,
  sessions,
  suffix,
  onSuffixChange,
  onUpload,
  onClear,
  onSelectSession,
  onDeleteSession,
  prefetchStatus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (raw: FileList | File[]) => {
    const files = Array.from(raw).filter((f) => /\.(csv|xlsx|xlsm)$/i.test(f.name))
    const rejected = Array.from(raw).length - files.length
    if (rejected > 0) alert(`${rejected} file(s) skipped — only CSV or XLSX supported`)
    if (files.length) onUpload(files.length === 1 ? files[0] : files)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files)
    e.target.value = ''
  }

  const formatDate = (iso: string) => {
    try {

      const normalized = /[Zz]$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z'
      const d = new Date(normalized)
      if (isNaN(d.getTime())) return iso
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Trade Files</h1>
        <p className="text-slate-400 text-sm">
          CSV or XLSX with columns: Trade, Symbol, Side, Quantity, Execution Price, Execution Date
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400 w-36 shrink-0">Exchange suffix</label>
        <input
          value={suffix}
          onChange={(e) => onSuffixChange(e.target.value.trim())}
          placeholder=".SR"
          className="bg-panel border border-border rounded px-3 py-1.5 text-sm text-white w-32 focus:outline-none focus:border-accent"
        />
        <span className="text-xs text-slate-500">e.g. .SR for Saudi, .T for Tokyo, blank for US</span>
      </div>

      {sessions.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Saved Files</h2>
          <div className="space-y-2">
            {sessions.map((s) => {
              const active = session?.session_id === s.session_id
              return (
                <div
                  key={s.session_id}
                  className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                    active
                      ? 'bg-accent/10 border-accent/50'
                      : 'bg-panel border-border hover:border-accent/30'
                  }`}
                >
                  <button
                    className="flex-1 text-left min-w-0"
                    onClick={() => onSelectSession(s.session_id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {active && (
                        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />
                      )}
                      <span className="text-white font-medium text-sm truncate">{s.filename}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 ml-0">
                      <span className="text-xs text-slate-500">{formatDate(s.uploaded_at)}</span>
                      <span className="text-xs text-slate-500">{s.trade_count} trades</span>
                      {s.symbols.length > 0 && (
                        <span className="text-xs text-slate-500 truncate">
                          {s.symbols.slice(0, 4).join(', ')}{s.symbols.length > 4 ? ` +${s.symbols.length - 4}` : ''}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSession(s.session_id) }}
                    className="ml-3 shrink-0 text-xs text-slate-500 hover:text-red-400 transition-colors border border-border hover:border-red-700/50 px-2 py-1 rounded"
                    title="Delete this file"
                  >
                    Delete
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div>
        {sessions.length > 0 && (
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-2">Upload New File</h2>
        )}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-accent/60 transition-colors select-none"
        >
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xlsm" multiple className="hidden" onChange={onChange} />
          {uploading ? (
            <div className="text-slate-400 text-sm animate-pulse">Uploading and parsing…</div>
          ) : (
            <>
              <div className="text-3xl mb-3">📂</div>
              <p className="text-white font-medium">Drop CSV or XLSX files here or click to browse</p>
              <p className="text-slate-500 text-xs mt-1">Multiple files supported · Max 50 MB each</p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {session && (
        <div className="bg-panel border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white font-semibold">{session.filename}</p>
              <p className="text-slate-400 text-sm mt-0.5">Active session</p>
            </div>
            <button
              onClick={onClear}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors border border-border px-2 py-1 rounded"
            >
              Deselect
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Total Trades', session.total_trades],
              ['Completed', session.completed],
              ['Ongoing', session.ongoing],
            ].map(([label, val]) => (
              <div key={label} className="bg-surface rounded-lg p-3">
                <div className="text-xl font-bold text-white">{val}</div>
                <div className="text-xs text-slate-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-2">Symbols detected</p>
            <div className="flex flex-wrap gap-2">
              {session.symbols.map((sym) => (
                <span key={sym} className="bg-accent/10 text-accent text-xs font-mono px-2 py-0.5 rounded">
                  {sym}
                </span>
              ))}
            </div>
          </div>
          {prefetchStatus && !prefetchStatus.done && prefetchStatus.total > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="animate-pulse">Preloading charts…</span>
                <span>{prefetchStatus.cached} / {prefetchStatus.total}</span>
              </div>
              <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${Math.round((prefetchStatus.cached / prefetchStatus.total) * 100)}%` }}
                />
              </div>
              {prefetchStatus.failed > 0 && (
                <p className="text-xs text-amber-500">{prefetchStatus.failed} failed (will fetch on demand)</p>
              )}
            </div>
          )}
          {prefetchStatus?.done && prefetchStatus.total > 0 && (
            <p className="text-xs text-emerald-500">
              Charts preloaded — navigation will be instant.
              {prefetchStatus.failed > 0 && ` (${prefetchStatus.failed} will fetch on demand)`}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Navigate to <strong className="text-slate-300">Trades</strong> or{' '}
            <strong className="text-slate-300">Chart</strong> to explore your data.
          </p>
        </div>
      )}
    </div>
    </div>
  )
}
