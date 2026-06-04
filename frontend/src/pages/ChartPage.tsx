import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TradeRow, UploadResponse } from '../types'
import TradeChart from '../components/TradeChart'
import { useChart } from '../hooks/useChart'

interface Props {
  session: UploadResponse | null
  suffix: string
  selectedSymbol: string | null
  selectedTradeId: string | null
  onSelectTrade: (symbol: string, tradeId: string) => void
}

export default function ChartPage({
  session,
  suffix,
  selectedSymbol,
  selectedTradeId,
  onSelectTrade,
}: Props) {
  const [trades, setTrades] = useState<TradeRow[]>([])
  const [filterSymbol, setFilterSymbol] = useState(selectedSymbol ?? '')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const { data, loading, error, load } = useChart(session?.session_id ?? '', suffix)

  useEffect(() => {
    if (!session) return
    const params: { from_date?: string; to_date?: string } = {}
    if (fromDate) params.from_date = fromDate
    if (toDate) params.to_date = toDate
    api.getTrades(session.session_id, params).then(setTrades).catch(console.error)
  }, [session, fromDate, toDate])

  // Reset stale filters when the loaded session changes — a previous CSV's
  // symbol/date range won't match the new file and would hide every trade.
  // Default to "All symbols" so selecting a trade never narrows the list.
  useEffect(() => {
    setFilterSymbol('')
    setFromDate('')
    setToDate('')
  }, [session?.session_id])

  useEffect(() => {
    if (session && selectedSymbol && selectedTradeId) {
      load(selectedSymbol, selectedTradeId)
    }
  }, [session, selectedSymbol, selectedTradeId, load])

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
        <span className="text-4xl">📂</span>
        <p>No file loaded. Go to Upload first.</p>
      </div>
    )
  }

  const symbols = [...new Set(trades.map((t) => t.symbol))].sort()
  const filteredTrades = trades.filter((t) => !filterSymbol || t.symbol === filterSymbol)

  const handleSelect = (symbol: string, tradeId: string) => {
    // only update selection — the effect above loads when it changes.
    // calling load() here too would fire a duplicate fetch.
    onSelectTrade(symbol, tradeId)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* sidebar — trade picker */}
      <aside className="w-64 shrink-0 border-r border-border bg-panel flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Suffix</span>
            <span className="font-mono text-slate-300 bg-surface px-1.5 py-0.5 rounded">
              {suffix.trim() || '(none)'}
            </span>
          </div>
          <select
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
            className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
          >
            <option value="">All symbols</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* execution-date range — keeps trades with any buy/sell executed in [from, to] */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Execution date range</span>
              {(fromDate || toDate) && (
                <button
                  onClick={() => {
                    setFromDate('')
                    setToDate('')
                  }}
                  className="text-accent hover:underline"
                >
                  clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
              />
              <span className="text-slate-500 text-xs">→</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {filteredTrades.map((t) => {
            const active = t.symbol === selectedSymbol && t.trade_id === selectedTradeId
            return (
              <button
                key={`${t.trade_id}_${t.symbol}`}
                onClick={() => handleSelect(t.symbol, t.trade_id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/40 transition-colors ${
                  active ? 'bg-accent/10 border-l-2 border-l-accent' : 'hover:bg-surface'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-accent">{t.symbol}</span>
                  <span
                    className={`text-xs px-1.5 rounded ${
                      t.status === 'completed'
                        ? 'bg-buy/10 text-buy'
                        : 'bg-orange-500/10 text-orange-400'
                    }`}
                  >
                    {t.status === 'completed' ? 'done' : 'open'}
                  </span>
                </div>
                <div className="text-xs text-white mt-0.5">Trade {t.trade_id}</div>
                <div className="text-xs text-slate-500 mt-0.5">{t.entry_date}</div>
                {t.realized_pl != null && (
                  <div
                    className={`text-xs font-medium mt-0.5 ${t.realized_pl >= 0 ? 'text-buy' : 'text-sell'}`}
                  >
                    P&L {t.realized_pl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                )}
              </button>
            )
          })}
          {filteredTrades.length === 0 && (
            <p className="text-slate-500 text-xs p-4">No trades for this symbol</p>
          )}
        </div>
      </aside>

      {/* chart area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* chart header */}
        {data && (
          <div className="px-4 py-2 border-b border-border bg-panel shrink-0 flex items-center gap-4 flex-wrap">
            <span className="font-bold text-white">{data.company_name}</span>
            <span className="font-mono text-xs text-slate-400">{data.ticker} · D</span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-medium ${
                data.status === 'completed'
                  ? 'bg-buy/10 text-buy'
                  : 'bg-orange-500/10 text-orange-400'
              }`}
            >
              {data.status === 'completed' ? 'Completed' : 'Ongoing'}
            </span>
            <span className="text-xs text-slate-400">{data.cycle_direction}</span>
            {data.realized_pl != null && (
              <span
                className={`text-xs font-semibold ml-auto ${
                  data.realized_pl >= 0 ? 'text-buy' : 'text-sell'
                }`}
              >
                P&L {data.realized_pl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            )}
            {data.avg_buy != null && (
              <span className="text-xs text-avgbuy">Avg Buy {data.avg_buy.toFixed(4)}</span>
            )}
            {data.avg_sell != null && (
              <span className="text-xs text-avgsell">Avg Sell {data.avg_sell.toFixed(4)}</span>
            )}
            {data.net_qty !== 0 && (
              <span className="text-xs text-slate-300">
                Net {data.net_qty > 0 ? 'Long' : 'Short'} {Math.abs(data.net_qty).toFixed(0)}
              </span>
            )}
          </div>
        )}

        {/* chart */}
        <div className="flex-1 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10">
              <div className="text-slate-400 animate-pulse text-sm">Loading chart data…</div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-slate-400 space-y-2">
                <div className="text-3xl">⚠️</div>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}
          {!data && !loading && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-slate-500 text-sm">Select a trade from the sidebar</p>
            </div>
          )}
          {data && <TradeChart data={data} />}
        </div>
      </div>
    </div>
  )
}
