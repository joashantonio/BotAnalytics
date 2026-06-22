import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import WalletSelector from './WalletSelector'
import type { SessionInfo, UploadResponse } from '../types'

interface Props {
  sessions: SessionInfo[]
  session: UploadResponse | null
  onSelectSession: (sessionId: string) => void
}

export default function Navbar({ sessions, session, onSelectSession }: Props) {
  const { pathname } = useLocation()
  const { theme, toggle } = useTheme()

  const link = (to: string, label: string) => (
    <Link
      to={to}
      className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
        pathname === to
          ? 'bg-accent/20 text-accent'
          : 'text-slate-400 hover:text-white'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="h-12 border-b border-border bg-panel flex items-center gap-3 px-4 shrink-0">
      <div className="flex items-center gap-1">
        {link('/dashboard', 'Dashboard')}
        {link('/', 'Upload')}
        {link('/trades', 'Trades')}
        {link('/chart', 'Chart')}
        {link('/analytics', 'Analytics')}
      </div>
      <div className="flex-1" />
      {/* Wallet picker — only on the per-wallet pages. Upload manages files;
          Dashboard aggregates across all wallets and has its own filter.
          Pinned to the right, just before the theme switch. */}
      {pathname !== '/' && pathname !== '/dashboard' && (
        <WalletSelector sessions={sessions} session={session} onSelect={onSelectSession} />
      )}
      <button
        onClick={toggle}
        className="px-3 py-1.5 rounded text-sm font-medium text-slate-400 hover:text-white border border-border transition-colors"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
    </nav>
  )
}
