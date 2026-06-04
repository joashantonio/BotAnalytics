import { Link, useLocation } from 'react-router-dom'

export default function Navbar() {
  const { pathname } = useLocation()

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
    <nav className="h-12 border-b border-border bg-panel flex items-center px-4 gap-1 shrink-0">
      <span className="font-bold text-white mr-4 text-sm tracking-wide">
        Trade Handler
      </span>
      {link('/', 'Upload')}
      {link('/trades', 'Trades')}
      {link('/chart', 'Chart')}
      {link('/analytics', 'Analytics')}
    </nav>
  )
}
