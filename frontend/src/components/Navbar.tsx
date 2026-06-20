import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'

export default function Navbar() {
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
    <nav className="relative h-12 border-b border-border bg-panel flex items-center px-4 shrink-0">
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
        {link('/dashboard', 'Dashboard')}
        {link('/', 'Upload')}
        {link('/trades', 'Trades')}
        {link('/chart', 'Chart')}
        {link('/analytics', 'Analytics')}
      </div>
      <button
        onClick={toggle}
        className="ml-auto px-3 py-1.5 rounded text-sm font-medium text-slate-400 hover:text-white border border-border transition-colors"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      >
        {theme === 'dark' ? '☀ Light' : '☾ Dark'}
      </button>
    </nav>
  )
}
