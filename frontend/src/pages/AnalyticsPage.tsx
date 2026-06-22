import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Analytics, CorrectExecutions, SelectedExec, UploadResponse } from '../types'
import AnalyticsDashboard, { SymbolBreakdown } from '../components/AnalyticsDashboard'
import ChartModal from '../components/ChartModal'
import { lsGet, lsSet } from '../lib/storage'

// Correct-Executions filters persist globally (survive reload + page switches +
// wallet changes). Not keyed by session — the same range/bot-type applies to
// every wallet so switching wallets keeps the filters put.
const CE_FROM_KEY = 'th:ce:from'
const CE_TO_KEY = 'th:ce:to'
const CE_BOT_KEY = 'th:ce:botType'

type SortKey = 'date' | 'symbol' | 'botType' | 'trade' | 'side' | 'price' | 'qty' | 'quartile' | 'result'

type CeMode = 'all' | 'psar' | 'bearsbot' | 'ma10' | 'ma200'
const isCeMode = (v: string | null): v is CeMode =>
  v === 'all' || v === 'psar' || v === 'bearsbot' || v === 'ma10' || v === 'ma200'

// Backend indicator mode that scores a given bot family. Maard→psar,
// Bears Bot→ma200, Bears Bot Booster→ma10. Returns null for unknown bots.
type BackendMode = 'psar' | 'ma10' | 'ma200'
const modeForBot = (raw: string): BackendMode | null => {
  const bt = (raw || '').toLowerCase()
  if (bt.includes('maard')) return 'psar'
  if (bt.includes('booster')) return 'ma10'
  if (bt.includes('bears bot')) return 'ma200'
  return null
}

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

  // ── Correct Executions (indicator-trend correctness, optional date range) ─────
  const [fromDate, setFromDate] = useState(() => lsGet(CE_FROM_KEY) ?? '')
  const [toDate, setToDate] = useState(() => lsGet(CE_TO_KEY) ?? '')
  // Bot Type → indicator the correctness check is scored against:
  // Maard Bot=PSAR, Bears Bot=MA200, Bears Bot Booster=MA10.
  const [ceMode, setCeMode] = useState<CeMode>(() => {
    const saved = lsGet(CE_BOT_KEY)
    return isCeMode(saved) ? saved : 'all'
  })
  // Backend correctness/chart mode — 'bearsbot' has no mode of its own; it
  // scores and plots against MA200.
  const fetchMode = ceMode === 'bearsbot' ? 'ma200' : ceMode
  const [ce, setCe] = useState<CorrectExecutions | null>(null)
  const [ceLoading, setCeLoading] = useState(false)
  const [ceError, setCeError] = useState<string | null>(null)
  const [execFilter, setExecFilter] = useState<'all' | 'correct' | 'wrong'>('all')
  const [sideFilter, setSideFilter] = useState<'all' | 'buy' | 'sell'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [execPage, setExecPage] = useState(0)
  const EXEC_PAGE_SIZE = 10

  // Execution chart modal — opened by clicking a row in the executions table.
  // `mode` is the indicator to plot: normally the active filter, but in "All"
  // mode it's derived per-row from the execution's own bot type.
  const [chartModal, setChartModal] = useState<{
    symbol: string
    tradeId: string
    exec: SelectedExec
    mode: CeMode
  } | null>(null)

  // back to first page whenever the filter or the underlying data changes
  useEffect(() => {
    setExecPage(0)
  }, [execFilter, sideFilter, sortKey, sortDir, ce])

  const openChart = (symbol: string, tradeId: string, exec: SelectedExec, mode: CeMode) => {
    setChartModal({ symbol, tradeId, exec, mode })
  }

  // Clear stale results whenever the inputs that define them change (wallet,
  // suffix, or bot/indicator mode). Without this, the previous wallet's stats
  // keep rendering until the next fetch lands — e.g. switching to a wallet that
  // has no Maard rows would still show the old wallet's Maard numbers. Filters
  // (date range + bot type) are global and intentionally carry over.
  useEffect(() => {
    setCe(null)
    setCeError(null)
  }, [session?.session_id, suffix, fetchMode])

  // Persist the filters globally whenever they change.
  useEffect(() => {
    lsSet(CE_FROM_KEY, fromDate || null)
    lsSet(CE_TO_KEY, toDate || null)
  }, [fromDate, toDate])

  useEffect(() => {
    lsSet(CE_BOT_KEY, ceMode)
  }, [ceMode])

  // auto-compute whenever the session, suffix, indicator mode, or date range changes
  useEffect(() => {
    if (!session) return
    const sid = session.session_id
    let cancelled = false
    setCeLoading(true)
    setCeError(null)

    const fetchOne = (mode: BackendMode) =>
      api.getCorrectExecutions(sid, suffix, fromDate || undefined, toDate || undefined, mode)

    // "All" = score every bot against its own indicator: fetch all three
    // modes, then from each keep only the executions that mode actually owns
    // (Maard rows from psar, Bears from ma200, Booster from ma10) and merge.
    // A single-mode call would mis-score the bots it doesn't own.
    const work: Promise<CorrectExecutions> =
      ceMode === 'all'
        ? Promise.all([fetchOne('psar'), fetchOne('ma10'), fetchOne('ma200')]).then(
            ([psar, ma10, ma200]) => {
              const ownedBy = (mode: BackendMode, data: CorrectExecutions) =>
                (data.executions ?? []).filter((e) => modeForBot(e.bot_type) === mode)
              const executions = [
                ...ownedBy('psar', psar),
                ...ownedBy('ma10', ma10),
                ...ownedBy('ma200', ma200),
              ]
              const skipped_symbols = [
                ...new Set([...psar.skipped_symbols, ...ma10.skipped_symbols, ...ma200.skipped_symbols]),
              ]
              // Top-level totals are unused — the render recomputes every stat
              // from `executions`. Only executions + skipped_symbols matter here.
              return { ...psar, executions, skipped_symbols }
            },
          )
        : fetchOne(fetchMode as BackendMode)

    work
      .then((data) => {
        if (!cancelled) setCe(data)
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
  }, [session, suffix, ceMode, fetchMode, fromDate, toDate])

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
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Portfolio Analytics</h1>
        <p className="text-sm text-slate-400 mt-1">
          Performance overview and indicator-scored execution accuracy.
        </p>
      </div>

      <section className="bg-panel border border-border rounded-xl p-5 shadow-sm">
        {loading && (
          <div className="text-slate-400 animate-pulse text-sm">Computing analytics…</div>
        )}
        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}
        {analytics && <AnalyticsDashboard analytics={analytics} showSymbolBreakdown={false} />}
      </section>

      <section className="bg-panel border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-white">Executions</h2>
        </div>
        <p className="text-xs text-slate-400 mb-5">
          {ceMode === 'all' ? (
            <>Every bot is scored against its own indicator — Maard Bot by PSAR, Bears Bot by
            MA200, Bears Bot Booster by MA10.</>
          ) : ceMode === 'psar' ? (
            <>A buy is “correct” when its execution date falls in a Maard Bot downtrend; a sell when
            it falls in an uptrend.</>
          ) : ceMode === 'bearsbot' ? (
            <>A buy is “correct” when its execution closes below the MA200; a sell when it closes
            above the MA200.</>
          ) : ceMode === 'ma10' ? (
            <>A buy is “correct” when its execution closes below the Bears Bot Booster line; a sell
            when it closes above it.</>
          ) : (
            <>A buy is “correct” when its execution closes below the MA200; a sell when it closes
            above the MA200.</>
          )}
          {' '}Optionally restrict to executions within a date range.
        </p>

        <div className="bg-surface border border-border rounded-lg px-3 py-2.5 mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="font-medium text-slate-400 uppercase tracking-wide">Filters</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Bot</span>
            <div className="flex rounded border border-border overflow-hidden">
              <button
                onClick={() => setCeMode('all')}
                className={`px-2.5 py-1 transition-colors ${
                  ceMode === 'all'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-panel text-slate-400 hover:text-white hover:bg-panel'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setCeMode('psar')}
                className={`px-2.5 py-1 transition-colors border-l border-border ${
                  ceMode === 'psar'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-panel text-slate-400 hover:text-white hover:bg-panel'
                }`}
              >
                Maard Bot
              </button>
              <button
                onClick={() => setCeMode('bearsbot')}
                className={`px-2.5 py-1 transition-colors border-l border-border ${
                  ceMode === 'bearsbot'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-panel text-slate-400 hover:text-white hover:bg-panel'
                }`}
              >
                Bears Bot
              </button>
              <button
                onClick={() => setCeMode('ma10')}
                className={`px-2.5 py-1 transition-colors border-l border-border ${
                  ceMode === 'ma10'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-panel text-slate-400 hover:text-white hover:bg-panel'
                }`}
              >
                Bears Bot Booster
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Date</span>
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-panel border border-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
            />
            <span className="text-slate-600">→</span>
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-panel border border-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent"
            />
          </div>
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
          {ceLoading && (
            <span className="ml-auto text-slate-400 animate-pulse">Computing…</span>
          )}
        </div>

        {ceError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {ceError}
          </div>
        )}

        {ce && (() => {
          // The backend scores EVERY execution in the wallet against the chosen
          // indicator and does not filter by bot type, so ce.* totals mix all
          // bots. The cards/quartiles must reflect only the executions matching
          // the active Bot Type filter — otherwise a wallet with no Maard rows
          // would still show non-zero Maard stats borrowed from its other bots.
          const botMatches = (raw: string) => {
            const bt = (raw || '').toLowerCase()
            if (ceMode === 'all') return true  // rows already scored per-bot at fetch
            if (ceMode === 'psar') return bt.includes('maard')
            if (ceMode === 'bearsbot') return bt.includes('bears bot') && !bt.includes('booster')
            if (ceMode === 'ma10') return bt.includes('booster')
            return true
          }
          const botExecs = (ce.executions ?? []).filter((e) => botMatches(e.bot_type))

          const total_executions = botExecs.length
          const buy_total = botExecs.filter((e) => e.side === 'buy').length
          const sell_total = botExecs.filter((e) => e.side === 'sell').length
          const correctExecutions = botExecs.filter((e) => e.correct).length
          const buyCorrect = botExecs.filter((e) => e.side === 'buy' && e.correct).length
          const sellCorrect = botExecs.filter((e) => e.side === 'sell' && e.correct).length
          const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0)
          const correctPct = pct(correctExecutions, total_executions)
          const buyPct = pct(buyCorrect, buy_total)
          const sellPct = pct(sellCorrect, sell_total)

          const wrongExecutions = total_executions - correctExecutions
          const buyWrong = buy_total - buyCorrect
          const sellWrong = sell_total - sellCorrect
          const wrongPct = pct(wrongExecutions, total_executions)
          const buyWrongPct = pct(buyWrong, buy_total)
          const sellWrongPct = pct(sellWrong, sell_total)

          // Quartile counts, recomputed over the bot-filtered correct rows.
          const qCount = (rows: typeof botExecs, q: 1 | 2 | 3 | 4) =>
            rows.filter((e) => e.correct && e.quartile === q).length
          const quartiles = { 1: qCount(botExecs, 1), 2: qCount(botExecs, 2), 3: qCount(botExecs, 3), 4: qCount(botExecs, 4) }
          const buyQuartiles = {
            1: botExecs.filter((e) => e.correct && e.quartile === 1 && e.side === 'buy').length,
            2: botExecs.filter((e) => e.correct && e.quartile === 2 && e.side === 'buy').length,
            3: botExecs.filter((e) => e.correct && e.quartile === 3 && e.side === 'buy').length,
            4: botExecs.filter((e) => e.correct && e.quartile === 4 && e.side === 'buy').length,
          }
          const sellQuartiles = {
            1: botExecs.filter((e) => e.correct && e.quartile === 1 && e.side === 'sell').length,
            2: botExecs.filter((e) => e.correct && e.quartile === 2 && e.side === 'sell').length,
            3: botExecs.filter((e) => e.correct && e.quartile === 3 && e.side === 'sell').length,
            4: botExecs.filter((e) => e.correct && e.quartile === 4 && e.side === 'sell').length,
          }
          return (
          <div className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Correct group */}
              <div className="rounded-lg border border-buy/30 bg-buy/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-buy text-sm">✓</span>
                  <h3 className="text-xs font-semibold text-buy uppercase tracking-wide">Correct</h3>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Overall</span>
                    <span className="text-2xl font-semibold tabular-nums text-buy">
                      {correctPct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {correctExecutions} / {total_executions}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Buys</span>
                    <span className="text-2xl font-semibold tabular-nums text-avgbuy">
                      {buyPct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {buyCorrect} / {buy_total}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Sells</span>
                    <span className="text-2xl font-semibold tabular-nums text-avgsell">
                      {sellPct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {sellCorrect} / {sell_total}
                    </span>
                  </div>
                </div>
              </div>
              {/* Incorrect group */}
              <div className="rounded-lg border border-sell/30 bg-sell/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sell text-sm">✕</span>
                  <h3 className="text-xs font-semibold text-sell uppercase tracking-wide">Incorrect</h3>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Overall</span>
                    <span className="text-2xl font-semibold tabular-nums text-sell">
                      {wrongPct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {wrongExecutions} / {total_executions}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Buys</span>
                    <span className="text-2xl font-semibold tabular-nums text-avgbuy">
                      {buyWrongPct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {buyWrong} / {buy_total}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wide">Sells</span>
                    <span className="text-2xl font-semibold tabular-nums text-avgsell">
                      {sellWrongPct.toFixed(1)}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {sellWrong} / {sell_total}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            {correctExecutions > 0 && (
              <div className="border-t border-border pt-5">
                <h3 className="text-sm font-medium text-white mb-2">
                  Quartile of Correct Executions
                </h3>
                <p className="text-xs text-slate-500 mb-2">
                  Where each correct execution landed inside its {ceMode === 'psar' ? 'Maard Bot' : ceMode === 'ma10' ? 'Bears Bot Booster' : ceMode === 'bearsbot' ? 'Bears Bot' : 'MA200'} trend
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
                      {([1, 2, 3, 4] as const).map((q) => {
                        const all = quartiles[q] ?? 0
                        const pct = correctExecutions > 0 ? (all / correctExecutions) * 100 : 0
                        return (
                          <tr key={q} className="border-b border-border/50 hover:bg-panel/60">
                            <td className="py-2 pr-4 font-medium text-white">Q{q}</td>
                            <td className="text-right py-2 pr-4 tabular-nums text-slate-300">
                              {all} <span className="text-slate-500">({pct.toFixed(1)}%)</span>
                            </td>
                            <td className="text-right py-2 pr-4 tabular-nums text-avgbuy">
                              {buyQuartiles[q] ?? 0}
                            </td>
                            <td className="text-right py-2 tabular-nums text-avgsell">
                              {sellQuartiles[q] ?? 0}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {botExecs.length > 0 && (() => {
              // botExecs is already restricted to the active Bot Type filter
              // (see the IIFE header). Apply only the correct/wrong toggle here.
              const filtered = botExecs
                .filter((e) =>
                  execFilter === 'all' ? true : execFilter === 'correct' ? e.correct : !e.correct,
                )
                .filter((e) => (sideFilter === 'all' ? true : e.side === sideFilter))
                .slice()
                .sort((a, b) => {
                  const dir = sortDir === 'asc' ? 1 : -1
                  let cmp = 0
                  switch (sortKey) {
                    case 'date':
                      cmp = a.exec_date.localeCompare(b.exec_date)
                      break
                    case 'symbol':
                      cmp = a.symbol.localeCompare(b.symbol)
                      break
                    case 'botType':
                      cmp = (a.bot_type || '').localeCompare(b.bot_type || '')
                      break
                    case 'trade':
                      cmp = a.trade_id.localeCompare(b.trade_id, undefined, { numeric: true })
                      break
                    case 'side':
                      cmp = a.side.localeCompare(b.side)
                      break
                    case 'price':
                      cmp = a.exec_price - b.exec_price
                      break
                    case 'qty':
                      cmp = a.qty - b.qty
                      break
                    case 'quartile':
                      cmp = (a.quartile ?? 0) - (b.quartile ?? 0)
                      break
                    case 'result':
                      cmp = Number(a.correct) - Number(b.correct)
                      break
                  }
                  return cmp * dir
                })
              const toggleSort = (key: SortKey) => {
                if (sortKey === key) {
                  setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                } else {
                  setSortKey(key)
                  setSortDir('asc')
                }
              }
              const SortArrow = ({ k }: { k: SortKey }) =>
                sortKey === k ? (
                  <span className="text-accent text-base font-bold ml-1">{sortDir === 'asc' ? '▲' : '▼'}</span>
                ) : (
                  <span className="text-slate-500 text-base font-bold ml-1">⇅</span>
                )
              const thSort = (k: SortKey) =>
                sortKey === k ? 'text-accent' : 'hover:text-white'
              const pageCount = Math.max(1, Math.ceil(filtered.length / EXEC_PAGE_SIZE))
              const page = Math.min(execPage, pageCount - 1)
              const start = page * EXEC_PAGE_SIZE
              const pageRows = filtered.slice(start, start + EXEC_PAGE_SIZE)
              return (
                <div className="border-t border-border pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-white">
                      Inspect Execution on Chart
                    </h3>
                    <div className="flex items-center gap-2 text-xs">
                      <select
                        value={sideFilter}
                        onChange={(e) => setSideFilter(e.target.value as 'all' | 'buy' | 'sell')}
                        className="px-2 py-1 rounded bg-panel border border-border text-slate-300 capitalize"
                      >
                        <option value="all">All Sides</option>
                        <option value="buy">Buy</option>
                        <option value="sell">Sell</option>
                      </select>
                      <div className="flex gap-1">
                        {(['all', 'correct', 'wrong'] as const).map((f) => (
                          <button
                            key={f}
                            onClick={() => setExecFilter(f)}
                            className={`px-2 py-1 rounded capitalize transition-colors ${
                              execFilter === f
                                ? 'bg-accent/20 text-accent font-medium'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">
                    Click a column header to sort; click a row to view its trade chart.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 bg-surface border-b border-border">
                          <th
                            onClick={() => toggleSort('date')}
                            className={`text-left py-2 px-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('date')}`}
                          >
                            Date<SortArrow k="date" />
                          </th>
                          <th
                            onClick={() => toggleSort('symbol')}
                            className={`text-left py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('symbol')}`}
                          >
                            Symbol<SortArrow k="symbol" />
                          </th>
                          <th
                            onClick={() => toggleSort('botType')}
                            className={`text-left py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('botType')}`}
                          >
                            Bot Type<SortArrow k="botType" />
                          </th>
                          <th
                            onClick={() => toggleSort('trade')}
                            className={`text-left py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('trade')}`}
                          >
                            Trade<SortArrow k="trade" />
                          </th>
                          <th
                            onClick={() => toggleSort('side')}
                            className={`text-left py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('side')}`}
                          >
                            Side<SortArrow k="side" />
                          </th>
                          <th
                            onClick={() => toggleSort('price')}
                            className={`text-right py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('price')}`}
                          >
                            Price<SortArrow k="price" />
                          </th>
                          <th
                            onClick={() => toggleSort('qty')}
                            className={`text-right py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('qty')}`}
                          >
                            Qty<SortArrow k="qty" />
                          </th>
                          <th
                            onClick={() => toggleSort('quartile')}
                            className={`text-center py-2 pr-4 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('quartile')}`}
                          >
                            Quartile<SortArrow k="quartile" />
                          </th>
                          <th
                            onClick={() => toggleSort('result')}
                            className={`text-center py-2 pr-2 cursor-pointer select-none whitespace-nowrap transition-colors ${thSort('result')}`}
                          >
                            Result<SortArrow k="result" />
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((e, i) => (
                          <tr
                            key={`${e.trade_id}_${e.symbol}_${e.side}_${e.exec_date}_${start + i}`}
                            onClick={() =>
                              openChart(
                                e.symbol,
                                e.trade_id,
                                {
                                  date: e.exec_date,
                                  side: e.side,
                                  price: e.exec_price,
                                },
                                ceMode === 'all' ? (modeForBot(e.bot_type) ?? 'psar') : ceMode,
                              )
                            }
                            className="border-b border-border/50 odd:bg-surface hover:bg-accent/10 cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-4 text-slate-300 whitespace-nowrap">{e.exec_date}</td>
                            <td className="py-2 pr-4 font-mono font-medium text-white">{e.symbol}</td>
                            <td className="py-2 pr-4 text-slate-300">{e.bot_type || '—'}</td>
                            <td className="py-2 pr-4 text-slate-400">{e.trade_id}</td>
                            <td
                              className={`py-2 pr-4 font-medium ${e.side === 'buy' ? 'text-avgbuy' : 'text-avgsell'}`}
                            >
                              {e.side === 'buy' ? 'Buy' : 'Sell'}
                            </td>
                            <td className="text-right py-2 pr-4 font-mono text-slate-300">
                              {e.exec_price.toFixed(4)}
                            </td>
                            <td className="text-right py-2 pr-4 tabular-nums text-slate-400">
                              {e.qty}
                            </td>
                            <td className="text-center py-2 pr-4 tabular-nums text-slate-400">
                              {e.quartile != null ? `Q${e.quartile}` : '—'}
                            </td>
                            <td className="text-center py-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded font-medium ${
                                  e.correct ? 'bg-buy/10 text-buy' : 'bg-sell/10 text-sell'
                                }`}
                              >
                                {e.correct ? 'Correct' : 'Wrong'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* pagination */}
                  <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                    <span>
                      {filtered.length === 0
                        ? 'No executions'
                        : `${start + 1}–${start + pageRows.length} of ${filtered.length}`}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setExecPage(0)}
                        disabled={page <= 0}
                        className="px-2 py-1 rounded border border-border hover:bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        « First
                      </button>
                      <button
                        onClick={() => setExecPage((p) => Math.max(0, p - 1))}
                        disabled={page <= 0}
                        className="px-2 py-1 rounded border border-border hover:bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        ‹ Prev
                      </button>
                      <span className="px-2 text-slate-300">
                        Page {page + 1} / {pageCount}
                      </span>
                      <button
                        onClick={() => setExecPage((p) => Math.min(pageCount - 1, p + 1))}
                        disabled={page >= pageCount - 1}
                        className="px-2 py-1 rounded border border-border hover:bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Next ›
                      </button>
                      <button
                        onClick={() => setExecPage(pageCount - 1)}
                        disabled={page >= pageCount - 1}
                        className="px-2 py-1 rounded border border-border hover:bg-panel disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Last »
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()}
            {total_executions === 0 && (
              <p className="text-slate-500 text-sm">
                No {ceMode === 'all' ? '' : ceMode === 'psar' ? 'Maard Bot ' : ceMode === 'bearsbot' ? 'Bears Bot ' : ceMode === 'ma10' ? 'Bears Bot Booster ' : 'MA200 '}executions in the selected range.
              </p>
            )}
            {ce.skipped_symbols.length > 0 && (
              <p className="text-xs text-orange-400">
                Skipped (no market data): {ce.skipped_symbols.join(', ')}
              </p>
            )}
          </div>
          )
        })()}
      </section>

      {analytics && (
        <section className="bg-panel border border-border rounded-xl p-5 shadow-sm">
          <SymbolBreakdown analytics={analytics} />
        </section>
      )}
    </div>
    {chartModal && session && (
      <ChartModal
        sessionId={session.session_id}
        suffix={suffix}
        symbol={chartModal.symbol}
        tradeId={chartModal.tradeId}
        exec={chartModal.exec}
        mode={chartModal.mode === 'all' ? 'psar' : chartModal.mode}
        onClose={() => setChartModal(null)}
      />
    )}
    </div>
  )
}
