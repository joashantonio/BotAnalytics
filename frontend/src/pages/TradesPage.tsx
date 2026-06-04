import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { TradeRow, UploadResponse } from '../types'

interface Props {
  session: UploadResponse | null
  suffix: string
  onSelectTrade: (symbol: string, tradeId: string) => void
}

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}

export default function TradesPage({ session, suffix, onSelectTrade }: Props) {
  const [trades, setTrades] = useState<TradeRow[]>([])
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'ongoing'>('all')
  const [filterSymbol, setFilterSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [chartingId, setChartingId] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (!session) return
    setLoading(true)
    api
      .getTrades(session.session_id)
      .then(setTrades)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [session])

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
        <span className="text-4xl">📂</span>
        <p>No file loaded. Go to Upload first.</p>
      </div>
    )
  }

  const filtered = trades.filter((t) => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    if (filterSymbol && !t.symbol.toLowerCase().includes(filterSymbol.toLowerCase())) return false
    return true
  })

  const symbols = [...new Set(trades.map((t) => t.symbol))].sort()

  const handleChart = async (trade: TradeRow) => {
    setChartingId(`${trade.trade_id}_${trade.symbol}`)
    onSelectTrade(trade.symbol, trade.trade_id)
    navigate('/chart')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 flex-wrap">
        <span className="text-sm text-slate-400">{filtered.length} trades</span>
        <div className="flex gap-1">
          {(['all', 'completed', 'ongoing'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                filterStatus === s
                  ? 'bg-accent/20 text-accent'
                  : 'text-slate-400 hover:text-white border border-border'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          value={filterSymbol}
          onChange={(e) => setFilterSymbol(e.target.value)}
          className="bg-panel border border-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent ml-auto"
        >
          <option value="">All symbols</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* table */}
      <div className="overflow-auto flex-1">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 animate-pulse">
            Loading trades…
          </div>
        ) : (
          <table className="w-full text-sm min-w-[800px]">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-border">
                {[
                  { label: 'Trade', align: 'text-left' },
                  { label: 'Symbol', align: 'text-left' },
                  { label: 'Status', align: 'text-left' },
                  { label: 'Entry', align: 'text-left' },
                  { label: 'Exit', align: 'text-left' },
                  { label: 'Buy Qty', align: 'text-right' },
                  { label: 'Sell Qty', align: 'text-right' },
                  { label: 'Net', align: 'text-right' },
                  { label: 'Avg Buy', align: 'text-right' },
                  { label: 'Avg Sell', align: 'text-right' },
                  { label: 'P&L', align: 'text-right' },
                  { label: '', align: 'text-left' },
                ].map((h, i) => (
                  <th
                    key={h.label || `col-${i}`}
                    className={`py-2 px-3 font-medium whitespace-nowrap ${h.align}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const key = `${t.trade_id}_${t.symbol}`
                return (
                  <tr
                    key={key}
                    className="border-b border-border/40 hover:bg-panel/60 transition-colors"
                  >
                    <td className="py-2 px-3 font-mono text-white">{t.trade_id}</td>
                    <td className="py-2 px-3 font-mono font-medium text-accent">{t.symbol}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${
                          t.status === 'completed'
                            ? 'bg-buy/10 text-buy'
                            : 'bg-orange-500/10 text-orange-400'
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300 whitespace-nowrap">{t.entry_date}</td>
                    <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                      {t.exit_date ?? '—'}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-right">{fmt(t.buy_qty, 0)}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{fmt(t.sell_qty, 0)}</td>
                    <td className="py-2 px-3 tabular-nums text-right font-medium">
                      {fmt(t.net_qty, 0)}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-right text-avgbuy">
                      {fmt(t.avg_buy, 4)}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-right text-avgsell">
                      {fmt(t.avg_sell, 4)}
                    </td>
                    <td
                      className={`py-2 px-3 tabular-nums text-right font-medium ${
                        t.realized_pl == null
                          ? 'text-slate-400'
                          : t.realized_pl >= 0
                            ? 'text-buy'
                            : 'text-sell'
                      }`}
                    >
                      {fmt(t.realized_pl)}
                    </td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => handleChart(t)}
                        disabled={chartingId === key}
                        className="text-xs px-2 py-1 border border-accent/40 text-accent rounded hover:bg-accent/10 transition-colors disabled:opacity-40"
                      >
                        Chart
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-12 text-center text-slate-500">
                    No trades match current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
