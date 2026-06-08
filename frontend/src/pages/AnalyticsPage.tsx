import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Analytics, CorrectExecutions, UploadResponse } from '../types'
import AnalyticsDashboard from '../components/AnalyticsDashboard'

interface Props {
  session: UploadResponse | null
  suffix: string
  analytics: Analytics | null
  loading: boolean
  error: string | null
  onEnter: (session: UploadResponse | null, suffix: string) => void
}

export default function AnalyticsPage({ session, suffix, analytics, loading, error, onEnter }: Props) {
  useEffect(() => {
    onEnter(session, suffix)
  }, [session, suffix, onEnter])

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [ceMode, setCeMode] = useState<'psar' | 'ma10' | 'ma200'>('psar')
  const [ce, setCe] = useState<CorrectExecutions | null>(null)
  const [ceLoading, setCeLoading] = useState(false)
  const [ceError, setCeError] = useState<string | null>(null)

  useEffect(() => {
    setFromDate('')
    setToDate('')
    setCe(null)
    setCeError(null)
  }, [session?.session_id])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    setCeLoading(true)
    setCeError(null)
    api
      .getCorrectExecutions(session.session_id, suffix, fromDate || undefined, toDate || undefined, ceMode)
      .then((data) => {
        if (cancelled) return
        setCe(data)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setCeError(e instanceof Error ? e.message : 'Failed to compute correct executions')
        setCe(null)
      })
      .finally(() => {
        if (!cancelled) setCeLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [session, suffix, ceMode, fromDate, toDate])

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
        <span className="text-4xl">📂</span>
        <p>No file loaded. Go to Upload first.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white mb-6">Portfolio Analytics</h1>
        {loading && (
          <div className="text-slate-400 animate-pulse text-sm">Computing analytics…</div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}
        {analytics && <AnalyticsDashboard analytics={analytics} />}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Correct Executions</h2>
        <p className="text-xs text-slate-400 mb-4">
          {ceMode === 'psar' ? (
            <>A buy is “correct” when its execution date falls in a PSAR downtrend; a sell when it
            falls in an uptrend.</>
          ) : ceMode === 'ma10' ? (
            <>A buy is “correct” when its execution closes below the MA10; a sell when it closes
            above the MA10.</>
          ) : (
            <>A buy is “correct” when its execution closes below the MA200; a sell when it closes
            above the MA200.</>
          )}
          {' '}Optionally restrict to executions within a date range.
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            Indicator
            <div className="flex rounded border border-border overflow-hidden text-xs">
              <button
                onClick={() => setCeMode('psar')}
                className={`px-3 py-1.5 transition-colors ${
                  ceMode === 'psar'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                PSAR
              </button>
              <button
                onClick={() => setCeMode('ma10')}
                className={`px-3 py-1.5 transition-colors border-l border-border ${
                  ceMode === 'ma10'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                MA10
              </button>
              <button
                onClick={() => setCeMode('ma200')}
                className={`px-3 py-1.5 transition-colors border-l border-border ${
                  ceMode === 'ma200'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                MA200
              </button>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-surface border border-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-surface border border-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent"
            />
          </label>
          {(fromDate || toDate) && (
            <button
              onClick={() => {
                setFromDate('')
                setToDate('')
              }}
              className="text-xs text-accent hover:underline pb-2"
            >
              clear
            </button>
          )}
          {ceLoading && <span className="ml-auto text-xs text-slate-400 animate-pulse">Computing…</span>}
        </div>

        {ceError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {ceError}
          </div>
        )}

        {ce && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Correct %</span>
                <span
                  className={`text-2xl font-semibold tabular-nums ${ce.correct_pct >= 50 ? 'text-buy' : 'text-sell'}`}
                >
                  {ce.correct_pct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500">
                  {ce.correct_executions} / {ce.total_executions} executions
                </span>
              </div>
              <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Buys correct</span>
                <span className="text-2xl font-semibold tabular-nums text-avgbuy">
                  {ce.buy_pct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500">
                  {ce.buy_correct} / {ce.buy_total} buys
                </span>
              </div>
              <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Sells correct</span>
                <span className="text-2xl font-semibold tabular-nums text-avgsell">
                  {ce.sell_pct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500">
                  {ce.sell_correct} / {ce.sell_total} sells
                </span>
              </div>
            </div>
            {ce.correct_executions > 0 && ce.quartiles && (
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">
                  Quartile of Correct Executions
                </h3>
                <p className="text-xs text-slate-500 mb-2">
                  Where each correct execution landed inside its {ceMode === 'psar' ? 'PSAR' : ceMode === 'ma10' ? 'MA10' : 'MA200'} trend
                  block (Q1 = lowest price band, Q4 = highest).
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 border-b border-border">
                        <th className="text-left py-2 pr-4">Quartile</th>
                        <th className="text-right py-2 pr-4">All</th>
                        <th className="text-right py-2 pr-4">Buys</th>
                        <th className="text-right py-2">Sells</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['1', '2', '3', '4'] as const).map((q) => {
                        const all = ce.quartiles[q] ?? 0
                        const pct = ce.correct_executions > 0 ? (all / ce.correct_executions) * 100 : 0
                        return (
                          <tr key={q} className="border-b border-border/50 hover:bg-panel/60">
                            <td className="py-2 pr-4 font-medium text-white">Q{q}</td>
                            <td className="text-right py-2 pr-4 tabular-nums text-slate-300">
                              {all} <span className="text-slate-500">({pct.toFixed(1)}%)</span>
                            </td>
                            <td className="text-right py-2 pr-4 tabular-nums text-avgbuy">
                              {ce.buy_quartiles?.[q] ?? 0}
                            </td>
                            <td className="text-right py-2 tabular-nums text-avgsell">
                              {ce.sell_quartiles?.[q] ?? 0}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {ce.total_executions === 0 && (
              <p className="text-slate-500 text-sm">No executions in the selected range.</p>
            )}
            {ce.skipped_symbols.length > 0 && (
              <p className="text-xs text-orange-400">
                Skipped (no market data): {ce.skipped_symbols.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
