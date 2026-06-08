import type { Analytics } from '../types'

interface Props {
  analytics: Analytics
  /** Render the Symbol Breakdown table inline. Default true. */
  showSymbolBreakdown?: boolean
}

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color?: string
}) {
  return (
    <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${color ?? 'text-white'}`}>
        {value}
      </span>
    </div>
  )
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function plColor(n: number | null | undefined): string {
  if (n == null) return 'text-white'
  return n >= 0 ? 'text-buy' : 'text-sell'
}

export function SymbolBreakdown({ analytics: a }: { analytics: Analytics }) {
  if (!a.symbol_breakdown || a.symbol_breakdown.length === 0) return null
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">
        Symbol Breakdown
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 border-b border-border">
              <th className="text-left py-2 pr-4">Symbol</th>
              <th className="text-right py-2 pr-4">Trades</th>
              <th className="text-right py-2 pr-4">Ongoing</th>
              <th className="text-right py-2">P&L</th>
            </tr>
          </thead>
          <tbody>
            {a.symbol_breakdown.map((row) => (
              <tr key={row.symbol} className="border-b border-border/50 hover:bg-panel/60">
                <td className="py-2 pr-4 font-mono font-medium text-white">{row.symbol}</td>
                <td className="text-right py-2 pr-4 text-slate-300">{row.trades}</td>
                <td className="text-right py-2 pr-4 text-slate-300">{row.ongoing}</td>
                <td className={`text-right py-2 font-mono ${plColor(row.pl)}`}>
                  {fmt(row.pl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AnalyticsDashboard({ analytics: a, showSymbolBreakdown = true }: Props) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Stat label="Total P&L" value={fmt(a.total_pl)} color={plColor(a.total_pl)} />
        <Stat label="Win Rate" value={`${fmt(a.win_rate, 1)}%`} color={a.win_rate >= 50 ? 'text-buy' : 'text-sell'} />
        <Stat label="Completed" value={a.completed_trades} />
        <Stat label="Ongoing" value={a.ongoing_trades} />
        <Stat label="Wins" value={a.wins} color="text-buy" />
        <Stat label="Losses" value={a.losses} color="text-sell" />
        <Stat label="Max Drawdown" value={fmt(a.max_drawdown)} color="text-orange-400" />
        <Stat label="Total Trades" value={a.total_trades} />
        {a.avg_buy != null && (
          <Stat label="Avg Buy" value={fmt(a.avg_buy, 4)} color="text-avgbuy" />
        )}
        {a.avg_sell != null && (
          <Stat label="Avg Sell" value={fmt(a.avg_sell, 4)} color="text-avgsell" />
        )}
      </div>

      {showSymbolBreakdown && <SymbolBreakdown analytics={a} />}
    </div>
  )
}
