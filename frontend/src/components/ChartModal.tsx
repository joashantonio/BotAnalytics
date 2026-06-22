import { useEffect, useRef, useState } from 'react'
import type { SelectedExec } from '../types'
import TradeChart, { type TradeChartHandle } from './TradeChart'
import { useChart } from '../hooks/useChart'
import { useTheme } from '../hooks/useTheme'

interface Props {
  sessionId: string
  suffix: string
  symbol: string
  tradeId: string
  exec: SelectedExec
  // Indicator to plot — mirrors the Analytics Bot Type filter. Maard Bot=psar,
  // Bears Bot=ma200, Bears Bot Booster=ma10.
  mode?: 'psar' | 'bearsbot' | 'ma10' | 'ma200'
  onClose: () => void
}

// Map the Analytics Bot Type to the backend chart indicator. 'bearsbot' has no
// backend mode of its own — it plots on the MA200 chart.
const PLOT_MODE: Record<'psar' | 'bearsbot' | 'ma10' | 'ma200', 'psar' | 'ma10' | 'ma200'> = {
  psar: 'psar',
  bearsbot: 'ma200',
  ma10: 'ma10',
  ma200: 'ma200',
}

/**
 * Renders the trade chart for a single execution in an overlay modal — picked
 * from the Analytics "Inspect Execution on Chart" table. Loads its own chart
 * data (independent of the Chart page) and highlights the chosen execution.
 */
export default function ChartModal({
  sessionId,
  suffix,
  symbol,
  tradeId,
  exec,
  mode = 'psar',
  onClose,
}: Props) {
  const { data, loading, error, load } = useChart(sessionId, suffix, PLOT_MODE[mode])
  const [showProfitPct, setShowProfitPct] = useState(false)
  const [drawPriceRange, setDrawPriceRange] = useState(false)
  const [priceRangeCount, setPriceRangeCount] = useState(0)
  const chartHandleRef = useRef<TradeChartHandle>(null)
  const { theme } = useTheme()

  useEffect(() => {
    load(symbol, tradeId)
  }, [symbol, tradeId, load])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="px-4 py-2 border-b border-border bg-panel shrink-0 flex items-center gap-4 flex-wrap">
          {data ? (
            <>
              <span className="font-bold text-white">{data.company_name}</span>
              <span className="font-mono text-xs text-slate-400">{data.ticker} · D</span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-medium ${data.status === 'completed'
                  ? 'bg-buy/10 text-buy'
                  : 'bg-orange-500/10 text-orange-400'
                  }`}
              >
                {data.status === 'completed' ? 'Completed' : 'Ongoing'}
              </span>
              <span className="text-xs text-slate-400">{data.cycle_direction}</span>
              {data.realized_pl != null && (
                <span
                  className={`text-xs font-semibold ${data.realized_pl >= 0 ? 'text-buy' : 'text-sell'
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
            </>
          ) : (
            <span className="font-mono text-sm text-white">
              {symbol} · Trade {tradeId}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3 shrink-0">
            {data && (
              <button
                onClick={() => setShowProfitPct((v) => !v)}
                className={`px-2 py-1 rounded border text-xs transition-colors ${showProfitPct
                  ? 'bg-accent/20 text-accent border-accent font-medium'
                  : 'bg-surface text-slate-400 border-border hover:text-white'
                  }`}
              >
                % Profit vs Avg Buy
              </button>
            )}
            {data && (
              <button
                onClick={() => setDrawPriceRange((v) => !v)}
                className={`px-2 py-1 rounded border text-xs transition-colors ${drawPriceRange
                  ? 'bg-accent/20 text-accent border-accent font-medium'
                  : 'bg-surface text-slate-400 border-border hover:text-white'
                  }`}
              >
                Price Range
              </button>
            )}
            {data && priceRangeCount > 0 && (
              <button
                onClick={() => chartHandleRef.current?.clearPriceRanges()}
                className="px-2 py-1 rounded border border-border text-xs text-slate-400 hover:text-white hover:border-sell transition-colors"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-xl leading-none px-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

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
          {data && (
            <TradeChart
              ref={chartHandleRef}
              data={data}
              highlightExec={exec}
              showProfitPct={showProfitPct}
              drawPriceRange={drawPriceRange}
              onPriceRangeCountChange={setPriceRangeCount}
              theme={theme}
            />
          )}
        </div>
      </div>
    </div>
  )
}
