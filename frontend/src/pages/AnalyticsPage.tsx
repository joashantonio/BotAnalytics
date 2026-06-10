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

type CeMode = 'psar' | 'bearsbot' | 'ma10' | 'ma200'
const isCeMode = (v: string | null): v is CeMode =>
  v === 'psar' || v === 'bearsbot' || v === 'ma10' || v === 'ma200'

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
  // Indicator the correctness check is scored against: PSAR trend, or MA10/MA200 cross.
  // 'bearsbot' has no backend scoring logic yet — it reuses the ma10 fetch for row
  // data and filters by bot_type only; its chart has no plot (see ChartModal).
  const [ceMode, setCeMode] = useState<CeMode>(() => {
    const saved = lsGet(CE_BOT_KEY)
    return isCeMode(saved) ? saved : 'psar'
  })
  // Backend correctness/chart mode — bearsbot has none, so borrow ma10's.
  const fetchMode = ceMode === 'bearsbot' ? 'ma10' : ceMode
  const [ce, setCe] = useState<CorrectExecutions | null>(null)
  const [ceLoading, setCeLoading] = useState(false)
  const [ceError, setCeError] = useState<string | null>(null)
  const [execFilter, setExecFilter] = useState<'all' | 'correct' | 'wrong'>('all')
  const [execPage, setExecPage] = useState(0)
  const EXEC_PAGE_SIZE = 10

  // Execution chart modal — opened by clicking a row in the executions table.
  const [chartModal, setChartModal] = useState<{
    symbol: string
    tradeId: string
    exec: SelectedExec
  } | null>(null)

  // back to first page whenever the filter or the underlying data changes
  useEffect(() => {
    setExecPage(0)
  }, [execFilter, ce])

  const openChart = (symbol: string, tradeId: string, exec: SelectedExec) => {
    setChartModal({ symbol, tradeId, exec })
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
    let cancelled = false
    setCeLoading(true)
    setCeError(null)
    api
      .getCorrectExecutions(
        session.session_id,
        suffix,
        fromDate || undefined,
        toDate || undefined,
        fetchMode,
      )
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
  }, [session, suffix, fetchMode, fromDate, toDate])

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
        {analytics && <AnalyticsDashboard analytics={analytics} showSymbolBreakdown={false} />}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-1">Executions</h2>
        <p className="text-xs text-slate-400 mb-4">
          {ceMode === 'psar' ? (
            <>A buy is “correct” when its execution date falls in a Maard Bot downtrend; a sell when
            it falls in an uptrend.</>
          ) : ceMode === 'bearsbot' ? (
            <>Bears Bot executions. Correctness/plot logic not defined yet — rows shown for
            inspection only.</>
          ) : ceMode === 'ma10' ? (
            <>A buy is “correct” when its execution closes below the Bears Bot Booster line; a sell
            when it closes above it.</>
          ) : (
            <>A buy is “correct” when its execution closes below the MA200; a sell when it closes
            above the MA200.</>
          )}
          {' '}Optionally restrict to executions within a date range.
        </p>

        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Filters</h3>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            Bot Type
            <div className="flex rounded border border-border overflow-hidden text-xs">
              <button
                onClick={() => setCeMode('psar')}
                className={`px-3 py-1.5 transition-colors ${
                  ceMode === 'psar'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                Maard Bot
              </button>
              <button
                onClick={() => setCeMode('bearsbot')}
                className={`px-3 py-1.5 transition-colors border-l border-border ${
                  ceMode === 'bearsbot'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                Bears Bot
              </button>
              <button
                onClick={() => setCeMode('ma10')}
                className={`px-3 py-1.5 transition-colors border-l border-border ${
                  ceMode === 'ma10'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'bg-surface text-slate-400 hover:text-white'
                }`}
              >
                Bears Bot Booster
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1 text-xs text-slate-400">
            Date Range
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                From
                <input
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="bg-surface border border-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                To
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="bg-surface border border-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent"
                />
              </label>
            </div>
          </div>
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
          {ceLoading && (
            <span className="ml-auto text-sm text-slate-400 animate-pulse pb-2">Computing…</span>
          )}
        </div>

        {ceError && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {ceError}
          </div>
        )}

        {ce && (() => {
          // Bears Bot has no correctness logic yet — force all correctness metrics to 0
          // and hide the quartile breakdown. The executions table still lists its rows.
          const isBearsBot = ceMode === 'bearsbot'

          // The backend scores EVERY execution in the wallet against the chosen
          // indicator and does not filter by bot type, so ce.* totals mix all
          // bots. The cards/quartiles must reflect only the executions matching
          // the active Bot Type filter — otherwise a wallet with no Maard rows
          // would still show non-zero Maard stats borrowed from its other bots.
          const botMatches = (raw: string) => {
            const bt = (raw || '').toLowerCase()
            if (ceMode === 'psar') return bt.includes('maard')
            if (ceMode === 'bearsbot') return bt.includes('bears bot') && !bt.includes('booster')
            if (ceMode === 'ma10') return bt.includes('booster')
            return true
          }
          const botExecs = (ce.executions ?? []).filter((e) => botMatches(e.bot_type))

          const total_executions = botExecs.length
          const buy_total = botExecs.filter((e) => e.side === 'buy').length
          const sell_total = botExecs.filter((e) => e.side === 'sell').length
          const correctExecutions = isBearsBot ? 0 : botExecs.filter((e) => e.correct).length
          const buyCorrect = isBearsBot ? 0 : botExecs.filter((e) => e.side === 'buy' && e.correct).length
          const sellCorrect = isBearsBot ? 0 : botExecs.filter((e) => e.side === 'sell' && e.correct).length
          const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0)
          const correctPct = pct(correctExecutions, total_executions)
          const buyPct = pct(buyCorrect, buy_total)
          const sellPct = pct(sellCorrect, sell_total)

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
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Correct %</span>
                <span
                  className={`text-2xl font-semibold tabular-nums ${correctPct >= 50 ? 'text-buy' : 'text-sell'}`}
                >
                  {correctPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500">
                  {correctExecutions} / {total_executions} executions
                </span>
              </div>
              <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Buys correct</span>
                <span className="text-2xl font-semibold tabular-nums text-avgbuy">
                  {buyPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500">
                  {buyCorrect} / {buy_total} buys
                </span>
              </div>
              <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
                <span className="text-xs text-slate-400 uppercase tracking-wide">Sells correct</span>
                <span className="text-2xl font-semibold tabular-nums text-avgsell">
                  {sellPct.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-500">
                  {sellCorrect} / {sell_total} sells
                </span>
              </div>
            </div>
            {!isBearsBot && correctExecutions > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-400 mb-2 uppercase tracking-wide">
                  Quartile of Correct Executions
                </h3>
                <p className="text-xs text-slate-500 mb-2">
                  Where each correct execution landed inside its {ceMode === 'psar' ? 'Maard Bot' : ceMode === 'ma10' ? 'Bears Bot Booster' : 'MA200'} trend
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
              const filtered = botExecs.filter((e) =>
                execFilter === 'all' ? true : execFilter === 'correct' ? e.correct : !e.correct,
              )
              const pageCount = Math.max(1, Math.ceil(filtered.length / EXEC_PAGE_SIZE))
              const page = Math.min(execPage, pageCount - 1)
              const start = page * EXEC_PAGE_SIZE
              const pageRows = filtered.slice(start, start + EXEC_PAGE_SIZE)
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-slate-400 uppercase tracking-wide">
                      Inspect Execution on Chart
                    </h3>
                    <div className="flex gap-1 text-xs">
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
                  <p className="text-xs text-slate-500 mb-2">
                    Click an execution to view its trade chart.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 border-b border-border">
                          <th className="text-left py-2 pr-4">Date</th>
                          <th className="text-left py-2 pr-4">Symbol</th>
                          <th className="text-left py-2 pr-4">Bot Type</th>
                          <th className="text-left py-2 pr-4">Trade</th>
                          <th className="text-left py-2 pr-4">Side</th>
                          <th className="text-right py-2 pr-4">Price</th>
                          <th className="text-right py-2 pr-4">Qty</th>
                          <th className="text-center py-2 pr-4">Quartile</th>
                          <th className="text-center py-2">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map((e, i) => (
                          <tr
                            key={`${e.trade_id}_${e.symbol}_${e.side}_${e.exec_date}_${start + i}`}
                            onClick={() =>
                              openChart(e.symbol, e.trade_id, {
                                date: e.exec_date,
                                side: e.side,
                                price: e.exec_price,
                              })
                            }
                            className="border-b border-border/50 hover:bg-panel/60 cursor-pointer"
                          >
                            <td className="py-2 pr-4 text-slate-300 whitespace-nowrap">{e.exec_date}</td>
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
                              {isBearsBot ? '—' : e.quartile != null ? `Q${e.quartile}` : '—'}
                            </td>
                            <td className="text-center py-2">
                              {isBearsBot ? (
                                <span className="text-xs text-slate-500">—</span>
                              ) : (
                                <span
                                  className={`text-xs px-2 py-0.5 rounded font-medium ${
                                    e.correct ? 'bg-buy/10 text-buy' : 'bg-sell/10 text-sell'
                                  }`}
                                >
                                  {e.correct ? 'Correct' : 'Wrong'}
                                </span>
                              )}
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
                No {ceMode === 'psar' ? 'Maard Bot' : ceMode === 'bearsbot' ? 'Bears Bot' : ceMode === 'ma10' ? 'Bears Bot Booster' : 'MA200'} executions in the selected range.
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
      </div>

      {analytics && <SymbolBreakdown analytics={analytics} />}
    </div>
    {chartModal && session && (
      <ChartModal
        sessionId={session.session_id}
        suffix={suffix}
        symbol={chartModal.symbol}
        tradeId={chartModal.tradeId}
        exec={chartModal.exec}
        mode={ceMode}
        onClose={() => setChartModal(null)}
      />
    )}
    </div>
  )
}
