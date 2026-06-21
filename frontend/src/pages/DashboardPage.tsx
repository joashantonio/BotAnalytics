import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { BotAnalytics, BotCard, BotExecPoint } from '../types'

// Date-range filter. Defaults the "From" date to 2026-05-19 so the dashboard
// opens on the post-fix window, but the user can change or clear either bound
// to view the full history — nothing is permanently hidden.
const FROM_KEY = 'th:dash:from'
const TO_KEY = 'th:dash:to'
const DEFAULT_FROM = '2026-05-19'
import DriftChart, { type DriftSeries } from '../components/DriftChart'
import { lsGet, lsSet } from '../lib/storage'
import { useTheme } from '../hooks/useTheme'

interface Props {
  suffix: string
}

type Gran = 'day' | 'week' | 'month' | 'year'
const GRAN_KEY = 'th:dash:gran'
const isGran = (v: string | null): v is Gran =>
  v === 'day' || v === 'week' || v === 'month' || v === 'year'

// Bot filter. 'both' shows Maard + Bears; 'maard'/'bears' show that bot only.
type BotFilter = 'both' | 'maard' | 'bears'
const BOT_KEY = 'th:dash:bot'
const isBotFilter = (v: string | null): v is BotFilter =>
  v === 'both' || v === 'maard' || v === 'bears'

const pct = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0)
const fmtPct = (n: number) => `${n.toFixed(1)}%`

/** Bucket an exec date (YYYY-MM-DD) to a representative date string for its
 * granularity. Week = ISO-ish Monday of that week; month = 1st; year = Jan 1. */
function bucketKey(date: string, gran: Gran): string {
  if (gran === 'day') return date
  const [y, m, d] = date.split('-').map(Number)
  if (gran === 'year') return `${y}-01-01`
  if (gran === 'month') return `${y}-${String(m).padStart(2, '0')}-01`
  // week: snap to Monday
  const dt = new Date(Date.UTC(y, m - 1, d))
  const dow = dt.getUTCDay() // 0=Sun..6=Sat
  const diff = (dow + 6) % 7 // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** Roll a bot's executions into accuracy-% per time bucket. */
function buildSeries(execs: BotExecPoint[], gran: Gran): DriftSeries[] {
  const buckets = new Map<string, { correct: number; total: number }>()
  for (const e of execs) {
    const key = bucketKey(e.date, gran)
    const b = buckets.get(key) ?? { correct: 0, total: 0 }
    b.total += 1
    if (e.correct) b.correct += 1
    buckets.set(key, b)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([time, b]) => ({ time, value: +pct(b.correct, b.total).toFixed(2) }))
}

/** Rebuild a bot's summary card from a (possibly date-filtered) exec list, so
 * the cards/summary/bars reflect the same range as every other view. The
 * backend card is whole-dataset; this recomputes counts from `execs`.
 * wallets_active can't be recomputed (series carries no session id) so it is
 * passed through from the backend card unchanged. */
function cardFromExecs(execs: BotExecPoint[], wallets_active: number): BotCard {
  let buy_total = 0, buy_correct = 0, sell_total = 0, sell_correct = 0
  for (const e of execs) {
    if (e.side === 'buy') {
      buy_total += 1
      if (e.correct) buy_correct += 1
    } else {
      sell_total += 1
      if (e.correct) sell_correct += 1
    }
  }
  const total = buy_total + sell_total
  const correct = buy_correct + sell_correct
  const round2 = (n: number, d: number) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)
  return {
    buy_total,
    buy_correct,
    buy_wrong: buy_total - buy_correct,
    buy_pct: round2(buy_correct, buy_total),
    sell_total,
    sell_correct,
    sell_wrong: sell_total - sell_correct,
    sell_pct: round2(sell_correct, sell_total),
    total,
    correct,
    overall_pct: round2(correct, total),
    wallets_active,
  }
}

const MAARD_COLOR = '#f57f17'
const BEARS_COLOR = '#e91e63'

interface LegendItem {
  label: string
  color: string
  /** line swatch (chart line) vs dot (category). Default dot. */
  shape?: 'line' | 'dot'
}

/** Title + plain-language explanation + optional colour legend, shown atop
 * every representation so users understand what they're looking at. */
function SectionHeader({
  title,
  explanation,
  legend,
  right,
}: {
  title: string
  explanation: string
  legend?: LegendItem[]
  right?: ReactNode
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="font-semibold text-white">{title}</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">{explanation}</p>
        {legend && legend.length > 0 && (
          <div className="flex items-center gap-4 text-xs mt-2 flex-wrap">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-slate-400">
                {l.shape === 'line' ? (
                  <span className="w-3 h-0.5" style={{ background: l.color }} />
                ) : (
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: l.color }} />
                )}
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {right}
    </div>
  )
}

// ── Overall summary table (both bots side by side) ───────────────────────────
function SummaryTable({
  maard,
  bears,
  showMaard,
  showBears,
}: {
  maard: BotCard
  bears: BotCard
  showMaard: boolean
  showBears: boolean
}) {
  const rows: { label: string; m: string; b: string; mGood?: boolean; bGood?: boolean }[] = [
    { label: 'Wallets active', m: String(maard.wallets_active), b: String(bears.wallets_active) },
    { label: 'Total executions', m: String(maard.total), b: String(bears.total) },
    { label: 'Overall accuracy', m: fmtPct(maard.overall_pct), b: fmtPct(bears.overall_pct), mGood: maard.overall_pct >= 50, bGood: bears.overall_pct >= 50 },
    { label: 'Buy execs', m: String(maard.buy_total), b: String(bears.buy_total) },
    { label: 'Buy accuracy', m: fmtPct(maard.buy_pct), b: fmtPct(bears.buy_pct), mGood: maard.buy_pct >= 50, bGood: bears.buy_pct >= 50 },
    { label: 'Sell execs', m: String(maard.sell_total), b: String(bears.sell_total) },
    { label: 'Sell accuracy', m: fmtPct(maard.sell_pct), b: fmtPct(bears.sell_pct), mGood: maard.sell_pct >= 50, bGood: bears.sell_pct >= 50 },
  ]
  const cell = (v: string, good?: boolean) =>
    good == null ? 'text-slate-200' : good ? 'text-buy' : 'text-sell'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 border-b border-border">
            <th className="text-left py-2 pr-4">Metric</th>
            {showMaard && (
              <th className="text-right py-2 pr-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: MAARD_COLOR }} /> Maard
                </span>
              </th>
            )}
            {showBears && (
              <th className="text-right py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: BEARS_COLOR }} /> Bears
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/50">
              <td className="py-2 pr-4 text-slate-400">{r.label}</td>
              {showMaard && (
                <td className={`text-right py-2 pr-4 font-mono tabular-nums ${cell(r.m, r.mGood)}`}>{r.m}</td>
              )}
              {showBears && (
                <td className={`text-right py-2 font-mono tabular-nums ${cell(r.b, r.bGood)}`}>{r.b}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Buy vs Sell correct/wrong grouped bars ───────────────────────────────────
function BarGroup({ label, correct, wrong }: { label: string; correct: number; wrong: number }) {
  const total = correct + wrong
  const cPct = total > 0 ? (correct / total) * 100 : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-500">
          {correct}/{total} ({fmtPct(cPct)})
        </span>
      </div>
      <div className="h-5 w-full rounded bg-surface overflow-hidden flex">
        <div className="bg-buy h-full" style={{ width: `${cPct}%` }} title={`${correct} correct`} />
        <div className="bg-sell h-full" style={{ width: `${100 - cPct}%` }} title={`${wrong} wrong`} />
      </div>
    </div>
  )
}

function BotBars({ name, color, card }: { name: string; color: string; card: BotCard }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="font-medium text-white text-sm">{name}</span>
      </div>
      <BarGroup label="Buy" correct={card.buy_correct} wrong={card.buy_wrong} />
      <BarGroup label="Sell" correct={card.sell_correct} wrong={card.sell_wrong} />
    </div>
  )
}

// ── Per-symbol breakdown (one table per bot) ─────────────────────────────────
interface SymRow {
  symbol: string
  total: number
  correct: number
  pct: number
}
function symbolRows(execs: BotExecPoint[]): SymRow[] {
  const m = new Map<string, { total: number; correct: number }>()
  for (const e of execs) {
    const g = m.get(e.symbol) ?? { total: 0, correct: 0 }
    g.total += 1
    if (e.correct) g.correct += 1
    m.set(e.symbol, g)
  }
  return [...m.entries()]
    .map(([symbol, g]) => ({ symbol, total: g.total, correct: g.correct, pct: pct(g.correct, g.total) }))
    .sort((a, b) => b.total - a.total)
}

function SymbolTable({ name, color, rows }: { name: string; color: string; rows: SymRow[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <h3 className="text-sm font-medium text-white">{name} · by symbol</h3>
      </div>
      {rows.length === 0 ? (
        <div className="text-slate-500 text-sm py-4">No executions.</div>
      ) : (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-slate-400 border-b border-border">
                <th className="text-left py-2 pr-4">Symbol</th>
                <th className="text-right py-2 pr-4">Execs</th>
                <th className="text-right py-2 pr-4">Correct</th>
                <th className="text-right py-2">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol} className="border-b border-border/50 hover:bg-surface/40">
                  <td className="py-2 pr-4 font-mono font-medium text-white">{r.symbol}</td>
                  <td className="text-right py-2 pr-4 text-slate-300 tabular-nums">{r.total}</td>
                  <td className="text-right py-2 pr-4 text-slate-300 tabular-nums">{r.correct}</td>
                  <td className={`text-right py-2 font-mono tabular-nums ${r.pct >= 50 ? 'text-buy' : 'text-sell'}`}>
                    {fmtPct(r.pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Quartile distribution (where correct execs landed in the trend block) ────
function QuartileBars({ name, color, execs }: { name: string; color: string; execs: BotExecPoint[] }) {
  const counts = [0, 0, 0, 0] // Q1..Q4
  for (const e of execs) {
    if (e.correct && e.quartile != null && e.quartile >= 1 && e.quartile <= 4) {
      counts[e.quartile - 1] += 1
    }
  }
  const max = Math.max(1, ...counts)
  const totalScored = counts.reduce((a, b) => a + b, 0)
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <h3 className="text-sm font-medium text-white">{name}</h3>
        <span className="text-xs text-slate-500">{totalScored} correct execs scored</span>
      </div>
      {totalScored === 0 ? (
        <div className="text-slate-500 text-sm py-4">No quartile-scored executions.</div>
      ) : (
        <div className="flex items-end gap-3 h-40">
          {counts.map((c, i) => (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
              <span className="text-xs tabular-nums text-slate-300">{c}</span>
              <div
                className="w-full rounded-t"
                style={{ height: `${(c / max) * 100}%`, background: color, minHeight: c > 0 ? 4 : 0 }}
                title={`Q${i + 1}: ${c}`}
              />
              <span className="text-xs text-slate-400">Q{i + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BotCardBlock({ name, color, card }: { name: string; color: string; card: BotCard }) {
  const Row = ({
    label,
    correct,
    wrong,
    total,
    p,
  }: {
    label: string
    correct: number
    wrong: number
    total: number
    p: number
  }) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-400 uppercase tracking-wide">{label}</span>
        <span className={`text-2xl font-semibold tabular-nums ${p >= 50 ? 'text-buy' : 'text-sell'}`}>
          {total > 0 ? fmtPct(p) : '—'}
        </span>
      </div>
      <div className="flex gap-3 text-xs tabular-nums">
        <span className="text-buy">✓ {correct} correct</span>
        <span className="text-sell">✗ {wrong} wrong</span>
        <span className="text-slate-500">/ {total}</span>
      </div>
    </div>
  )
  return (
    <div className="bg-panel border border-border rounded-lg p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="font-semibold text-white">{name}</span>
      </div>
      <Row label="Buy accuracy" correct={card.buy_correct} wrong={card.buy_wrong} total={card.buy_total} p={card.buy_pct} />
      <div className="h-px bg-border" />
      <Row label="Sell accuracy" correct={card.sell_correct} wrong={card.sell_wrong} total={card.sell_total} p={card.sell_pct} />
    </div>
  )
}

export default function DashboardPage({ suffix }: Props) {
  const [data, setData] = useState<BotAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gran, setGran] = useState<Gran>(() => {
    const s = lsGet(GRAN_KEY)
    return isGran(s) ? s : 'month'
  })
  // Date-range bounds (YYYY-MM-DD). 'From' defaults to DEFAULT_FROM; '' = open.
  const [from, setFrom] = useState<string>(() => {
    const s = lsGet(FROM_KEY)
    return s == null ? DEFAULT_FROM : s
  })
  const [to, setTo] = useState<string>(() => lsGet(TO_KEY) ?? '')
  // Which bot(s) to display. Defaults to 'both'.
  const [botFilter, setBotFilter] = useState<BotFilter>(() => {
    const s = lsGet(BOT_KEY)
    return isBotFilter(s) ? s : 'both'
  })
  const showMaard = botFilter === 'both' || botFilter === 'maard'
  const showBears = botFilter === 'both' || botFilter === 'bears'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getBotAnalytics(suffix)
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [suffix])

  const onGran = (g: Gran) => {
    setGran(g)
    lsSet(GRAN_KEY, g)
  }
  const onFrom = (v: string) => {
    setFrom(v)
    lsSet(FROM_KEY, v)
  }
  const onTo = (v: string) => {
    setTo(v)
    lsSet(TO_KEY, v)
  }
  const onBotFilter = (b: BotFilter) => {
    setBotFilter(b)
    lsSet(BOT_KEY, b)
  }
  // Show full history: clear both bounds.
  const showAll = () => {
    onFrom('')
    onTo('')
  }
  const isFiltered = from !== '' || to !== ''

  // Apply the date-range filter to the raw series. Both bounds inclusive;
  // either may be empty (open-ended). Dates are YYYY-MM-DD so string compare
  // is chronological.
  const filteredSeries = useMemo(() => {
    if (!data) return []
    return data.series.filter(
      (e) => (from === '' || e.date >= from) && (to === '' || e.date <= to),
    )
  }, [data, from, to])

  // Split executions by bot once; reused by the drift chart, symbol tables,
  // and quartile bars. Driven by the filtered series so every view respects
  // the selected date range.
  const { maardExecs, bearsExecs } = useMemo(
    () => ({
      maardExecs: filteredSeries.filter((e) => e.bot === 'maard'),
      bearsExecs: filteredSeries.filter((e) => e.bot === 'bears'),
    }),
    [filteredSeries],
  )

  // Cards recomputed from the filtered execs so headline accuracy matches the
  // range. wallets_active passes through from the backend (dataset-wide).
  const { maardCard, bearsCard } = useMemo(() => {
    if (!data) return { maardCard: null, bearsCard: null }
    if (!isFiltered) return { maardCard: data.maard, bearsCard: data.bears }
    return {
      maardCard: cardFromExecs(maardExecs, data.maard.wallets_active),
      bearsCard: cardFromExecs(bearsExecs, data.bears.wallets_active),
    }
  }, [data, isFiltered, maardExecs, bearsExecs])

  const { maardSeries, bearsSeries } = useMemo(
    () => ({
      maardSeries: buildSeries(maardExecs, gran),
      bearsSeries: buildSeries(bearsExecs, gran),
    }),
    [maardExecs, bearsExecs, gran],
  )

  const maardSymbols = useMemo(() => symbolRows(maardExecs), [maardExecs])
  const bearsSymbols = useMemo(() => symbolRows(bearsExecs), [bearsExecs])

  // drift chart canvas chrome must follow the app theme
  const { theme } = useTheme()

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">
          Prediction accuracy across all uploaded wallets
          {data ? ` · ${data.wallets} wallet${data.wallets === 1 ? '' : 's'}` : ''}.
          {isFiltered && (
            <span className="text-accent">
              {' '}· Date range: {from || '…'} → {to || '…'} (set at the bottom of the page).
            </span>
          )}
        </p>
      </div>

      {loading && <div className="text-slate-400 text-sm">Loading bot analytics…</div>}
      {error && <div className="text-sell text-sm">Error: {error}</div>}

      {data && !loading && maardCard && bearsCard && (
        <>
          {/* 4 metrics = 2 bots × (buy accuracy + sell accuracy) */}
          <div>
            <SectionHeader
              title="Bot Accuracy Cards"
              explanation="Each card is one bot, summarising its buy and sell prediction accuracy across every uploaded wallet. A prediction is 'correct' when the trade lands on the right side of the bot's indicator trend (Maard = PSAR, Bears = MA200/MA10). Green ≥ 50%, red below. Numbers under each percentage show the correct ✓ and wrong ✗ execution counts."
              legend={[
                ...(showMaard ? [{ label: 'Maard Bot', color: MAARD_COLOR }] : []),
                ...(showBears ? [{ label: 'Bears Bot', color: BEARS_COLOR }] : []),
              ]}
            />
            <div className={`grid grid-cols-1 gap-4 ${showMaard && showBears ? 'md:grid-cols-2' : ''}`}>
              {showMaard && <BotCardBlock name="Maard Bot" color={MAARD_COLOR} card={maardCard} />}
              {showBears && <BotCardBlock name="Bears Bot" color={BEARS_COLOR} card={bearsCard} />}
            </div>
          </div>

          {/* Drift over time */}
          <div className="bg-panel border border-border rounded-lg p-5">
            <SectionHeader
              title="Prediction Drift Over Time"
              explanation="Tracks each bot's prediction accuracy over time so you can spot when a bot starts drifting (getting better or worse). The Y axis is accuracy % (0–100); the X axis is time. Each point = correct ÷ total executions in that period. Use the dropdown to change the time bucket — finer buckets (daily) are spikier; coarser (monthly/yearly) are smoother."
              legend={[
                ...(showMaard ? [{ label: 'Maard', color: MAARD_COLOR, shape: 'line' as const }] : []),
                ...(showBears ? [{ label: 'Bears', color: BEARS_COLOR, shape: 'line' as const }] : []),
              ]}
              right={
                <select
                  value={gran}
                  onChange={(e) => onGran(e.target.value as Gran)}
                  className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
                >
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                </select>
              }
            />
            {(!showMaard || maardSeries.length === 0) && (!showBears || bearsSeries.length === 0) ? (
              <div className="text-slate-400 text-sm py-12 text-center">
                No scored executions yet. Upload wallets with a Bot column.
              </div>
            ) : (
              <DriftChart
                maard={showMaard ? maardSeries : []}
                bears={showBears ? bearsSeries : []}
                theme={theme}
              />
            )}
          </div>

          {/* Overall summary table + buy/sell bars */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-panel border border-border rounded-lg p-5">
              <SectionHeader
                title="Overall Summary"
                explanation="Side-by-side totals for both bots across all wallets: how many wallets each bot is active in, total executions, and overall / buy / sell accuracy. Percentages are green when ≥ 50% (more right than wrong) and red below. Use this to compare the two bots at a glance."
                legend={[
                  ...(showMaard ? [{ label: 'Maard', color: MAARD_COLOR }] : []),
                  ...(showBears ? [{ label: 'Bears', color: BEARS_COLOR }] : []),
                ]}
              />
              <SummaryTable maard={maardCard} bears={bearsCard} showMaard={showMaard} showBears={showBears} />
            </div>
            <div className="bg-panel border border-border rounded-lg p-5">
              <SectionHeader
                title="Buy vs Sell Accuracy"
                explanation="For each bot, two bars split buy and sell executions into the share that were correct (green) vs wrong (red). A longer green segment = more accurate. The label shows correct/total and the accuracy %. Lets you see whether a bot is better at timing buys or sells."
                legend={[
                  { label: 'Correct', color: '#26a69a' },
                  { label: 'Wrong', color: '#ef5350' },
                ]}
              />
              <div className="flex flex-col gap-6">
                {showMaard && <BotBars name="Maard Bot" color={MAARD_COLOR} card={maardCard} />}
                {showBears && <BotBars name="Bears Bot" color={BEARS_COLOR} card={bearsCard} />}
              </div>
            </div>
          </div>

          {/* Per-symbol breakdown */}
          <div className="bg-panel border border-border rounded-lg p-5">
            <SectionHeader
              title="Per-Symbol Breakdown"
              explanation="Breaks each bot's accuracy down by stock symbol so you can see which tickers a bot predicts well and which it struggles on. One table per bot, sorted by execution count (most-traded first). Columns: total executions, how many were correct, and the accuracy % (green ≥ 50%, red below). Scroll within a table if a bot has many symbols."
              legend={[
                ...(showMaard ? [{ label: 'Maard', color: MAARD_COLOR }] : []),
                ...(showBears ? [{ label: 'Bears', color: BEARS_COLOR }] : []),
              ]}
            />
            <div className={`grid grid-cols-1 gap-6 ${showMaard && showBears ? 'lg:grid-cols-2' : ''}`}>
              {showMaard && <SymbolTable name="Maard Bot" color={MAARD_COLOR} rows={maardSymbols} />}
              {showBears && <SymbolTable name="Bears Bot" color={BEARS_COLOR} rows={bearsSymbols} />}
            </div>
          </div>

          {/* Quartile distribution */}
          <div className="bg-panel border border-border rounded-lg p-5">
            <SectionHeader
              title="Quartile Distribution"
              explanation="Of the executions a bot got right, this shows WHERE in the price trend block they landed, split into four quartiles. Q1 = weakest entry (barely on the right side), Q4 = strongest entry (best possible spot in the trend). Taller bars on the right (Q3–Q4) mean a bot isn't just correct — it's entering at strong prices. Only correct executions are counted here."
              legend={[
                ...(showMaard ? [{ label: 'Maard', color: MAARD_COLOR }] : []),
                ...(showBears ? [{ label: 'Bears', color: BEARS_COLOR }] : []),
              ]}
            />
            <div className={`grid grid-cols-1 gap-8 ${showMaard && showBears ? 'lg:grid-cols-2' : ''}`}>
              {showMaard && <QuartileBars name="Maard Bot" color={MAARD_COLOR} execs={maardExecs} />}
              {showBears && <QuartileBars name="Bears Bot" color={BEARS_COLOR} execs={bearsExecs} />}
            </div>
          </div>

          {data.skipped_symbols.length > 0 && (
            <p className="text-xs text-slate-500">
              Skipped (no price data): {data.skipped_symbols.join(', ')}
            </p>
          )}

          {/* Date-range filter — controls every view above. Defaults to a
              start of 2026-05-19; clear or change either bound to see the full
              history. Placed at the bottom of the page by request. */}
          <div className="bg-panel border border-border rounded-lg p-5">
            <SectionHeader
              title="Filters"
              explanation="The Bot selector chooses which bot(s) every view above shows — Maard only, Bears only, or both. The date range limits every chart and table to executions within the selected dates (both bounds inclusive); defaults to starting 2026-05-19. Leave a date field empty for an open bound, or click 'Show all history' to clear the date filter. wallets-active counts remain dataset-wide."
            />
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Bot
                <select
                  value={botFilter}
                  onChange={(e) => onBotFilter(e.target.value as BotFilter)}
                  className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
                >
                  <option value="both">Both bots</option>
                  <option value="maard">Maard Bot</option>
                  <option value="bears">Bears Bot</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(e) => onFrom(e.target.value)}
                  className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(e) => onTo(e.target.value)}
                  className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={showAll}
                disabled={!isFiltered}
                className="border border-border rounded px-3 py-1.5 text-sm text-slate-200 hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Show all history
              </button>
              <button
                type="button"
                onClick={() => onFrom(DEFAULT_FROM)}
                className="border border-border rounded px-3 py-1.5 text-sm text-slate-200 hover:bg-surface"
              >
                Reset to {DEFAULT_FROM}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Showing {filteredSeries.length} of {data.series.length} executions
              {isFiltered ? ` · range ${from || '…'} → ${to || '…'}` : ' · full history'}.
            </p>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
