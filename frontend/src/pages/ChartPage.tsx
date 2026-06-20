import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SelectedExec, TradeRow, UploadResponse } from '../types'
import TradeChart from '../components/TradeChart'
import { useChart } from '../hooks/useChart'
import { useTheme } from '../hooks/useTheme'

interface Props {
  session: UploadResponse | null
  suffix: string
  selectedSymbol: string | null
  selectedTradeId: string | null
  selectedExec: SelectedExec | null
  onSelectTrade: (symbol: string, tradeId: string, exec?: SelectedExec) => void
}

export default function ChartPage({
  session,
  suffix,
  selectedSymbol,
  selectedTradeId,
  selectedExec,
  onSelectTrade,
}: Props) {
  const [trades, setTrades] = useState<TradeRow[]>([])
  const [filterSymbol, setFilterSymbol] = useState(selectedSymbol ?? '')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [indicatorMode, setIndicatorMode] = useState<'psar' | 'ma10' | 'ma200'>('psar')
  const [showProfitPct, setShowProfitPct] = useState(false)
  const { data, loading, error, load } = useChart(
    session?.session_id ?? '',
    suffix,
    indicatorMode,
    fromDate || undefined,
    toDate || undefined,
  )
  const { theme } = useTheme()

  useEffect(() => {
    if (!session) return
    const params: { from_date?: string; to_date?: string } = {}
    if (fromDate) params.from_date = fromDate
    if (toDate) params.to_date = toDate
    api.getTrades(session.session_id, params).then(setTrades).catch(console.error)
  }, [session, fromDate, toDate])

  useEffect(() => {
    setFilterSymbol('')
    setFromDate('')
    setToDate('')
  }, [session?.session_id])

  useEffect(() => {
    if (session && selectedSymbol && selectedTradeId) {
      load(selectedSymbol, selectedTradeId)
    }
  }, [session, selectedSymbol, selectedTradeId, indicatorMode, load])

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

  const handleSelect = (symbol: string, tradeId: string, botType: string) => {
    // Auto-pick the indicator that matches the trade's bot. Check "booster"
    // before "bears bot" since the former contains the latter as a substring.
    const bot = botType.toLowerCase()
    if (bot.includes('booster')) setIndicatorMode('ma10')
    else if (bot.includes('bears bot')) setIndicatorMode('ma200')
    else setIndicatorMode('psar') // Maard + unknown/empty
    onSelectTrade(symbol, tradeId)
  }

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="w-64 shrink-0 border-r border-border bg-panel flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Suffix</span>
            <span className="font-mono text-slate-300 bg-surface px-1.5 py-0.5 rounded">
              {suffix.trim() || '(none)'}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-slate-500">Indicator</span>
            <div className="flex rounded border border-border overflow-hidden text-xs">
              <button
                onClick={() => setIndicatorMode('psar')}
                className={`flex-1 px-2 py-1.5 transition-colors ${
                  indicatorMode === 'psar'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                PSAR
              </button>
              <button
                onClick={() => setIndicatorMode('ma10')}
                className={`flex-1 px-2 py-1.5 transition-colors border-l border-border ${
                  indicatorMode === 'ma10'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                MA10
              </button>
              <button
                onClick={() => setIndicatorMode('ma200')}
                className={`flex-1 px-2 py-1.5 transition-colors border-l border-border ${
                  indicatorMode === 'ma200'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                MA200
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowProfitPct((v) => !v)}
            className={`w-full px-2 py-1.5 rounded border text-xs transition-colors ${
              showProfitPct
                ? 'bg-accent/20 text-accent border-accent font-medium'
                : 'bg-surface text-slate-400 border-border hover:text-white'
            }`}
          >
            % Profit vs Avg Buy
          </button>

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
                onClick={() => handleSelect(t.symbol, t.trade_id, t.bot_type)}
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

      <div className="flex-1 flex flex-col overflow-hidden">
        {data && (
          <div className="px-4 py-2 border-b border-border bg-panel shrink-0 flex items-center gap-4">
            {/* Company name pinned leftmost. */}
            <span className="font-bold text-white truncate min-w-0">{data.company_name}</span>

            {/* Everything else pinned rightmost via ml-auto on the container (not a
                conditional item). Each metric is a fixed slot showing "—" when
                absent, so positions line up identically across trades. */}
            <div className="flex items-center gap-4 ml-auto shrink-0">
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
              <span
                className={`text-xs px-2 py-0.5 rounded font-medium ${
                  data.bot_type
                    ? 'bg-accent/15 text-accent'
                    : 'bg-slate-500/15 text-slate-400'
                }`}
              >
                {data.bot_type || 'Unknown'}
              </span>
              <span
                className={`text-xs font-semibold ${
                  data.realized_pl == null
                    ? 'text-slate-500'
                    : data.realized_pl >= 0
                      ? 'text-buy'
                      : 'text-sell'
                }`}
              >
                P&L{' '}
                {data.realized_pl == null
                  ? '—'
                  : data.realized_pl.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
              <span className="text-xs text-avgbuy">
                Avg Buy {data.avg_buy == null ? '—' : data.avg_buy.toFixed(4)}
              </span>
              <span className="text-xs text-avgsell">
                Avg Sell {data.avg_sell == null ? '—' : data.avg_sell.toFixed(4)}
              </span>
              <span className="text-xs text-slate-300">
                Net{' '}
                {data.net_qty === 0
                  ? '—'
                  : `${data.net_qty > 0 ? 'Long' : 'Short'} ${Math.abs(data.net_qty).toFixed(0)}`}
              </span>
            </div>
          </div>
        )}

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
          {data && <TradeChart data={data} highlightExec={selectedExec} showProfitPct={showProfitPct} theme={theme} />}
        </div>
      </div>
    </div>
  )
}
