import { useEffect, useRef, useState } from 'react'
import type { SessionInfo, UploadResponse } from '../types'

interface Props {
  sessions: SessionInfo[]
  session: UploadResponse | null
  onSelect: (sessionId: string) => void
}

/** Compact wallet/session picker for the navbar. Lists every uploaded file and
 *  switches the globally-active wallet. Selection lives in useSession, so every
 *  page reacts. Hidden when no wallets exist (nothing to pick yet). */
export default function WalletSelector({ sessions, session, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (sessions.length === 0) return null

  const label = session?.filename ?? 'Select wallet'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 max-w-[12rem] px-2.5 py-1 rounded border border-border bg-surface text-xs text-slate-300 hover:text-white hover:border-accent/40 transition-colors"
        title={label}
      >
        <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${session ? 'bg-accent' : 'bg-slate-500'}`} />
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-slate-500">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 max-h-80 overflow-y-auto rounded-lg border border-border bg-panel shadow-xl z-50 py-1">
          {sessions.map((s) => {
            const active = session?.session_id === s.session_id
            return (
              <button
                key={s.session_id}
                onClick={() => {
                  onSelect(s.session_id)
                  setOpen(false)
                }}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  active ? 'bg-accent/10' : 'hover:bg-surface'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {active && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-accent" />}
                  <span className="text-sm text-white truncate">{s.filename}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {s.trade_count} trades
                  {s.symbols.length > 0 && ` · ${s.symbols.slice(0, 3).join(', ')}${s.symbols.length > 3 ? ` +${s.symbols.length - 3}` : ''}`}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
