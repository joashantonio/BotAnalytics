import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
} from 'lightweight-charts'
import type { ChartData, SelectedExec } from '../types'
import { QuartileBoxPrimitive } from './QuartileBoxPrimitive'
import { PinMarkerPrimitive, type PinMarker, type PinHighlight } from './PinMarkerPrimitive'
import { ExecDateHighlightPrimitive } from './ExecDateHighlightPrimitive'
import { SelectedExecLinePrimitive } from './SelectedExecLinePrimitive'
import { ProfitPctPrimitive } from './ProfitPctPrimitive'
import { chartChrome } from '../lib/chartTheme'

interface Props {
  data: ChartData
  /** Execution picked from the Executions table to emphasise; null otherwise. */
  highlightExec?: SelectedExec | null
  /** When true, show each candle's profit % vs. avg buy: (high - avgBuy) / avgBuy * 100. */
  showProfitPct?: boolean
  /** App theme; passed so the chart re-creates with matching chrome on toggle. */
  theme?: 'dark' | 'light'
}

const COLORS = {
  bg: '#1a1d23',
  grid: '#2d3240',
  text: '#94a3b8',
  border: '#2d3240',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
  psar: '#f57f17',
  ma10: '#2962ff',
  ma200: '#e91e63',
  buy: '#00c853',
  sell: '#f44336',
  avgBuy: '#ffd600',
  avgSell: '#9c27b0',
  volUp: '#a5d6a7',
  volDown: '#ef9a9a',
  lastClose: '#90caf9',
  mixed: '#1565c0',
}

export default function TradeChart({ data, highlightExec, showProfitPct, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chrome = chartChrome(theme)
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: chrome.bg },
        textColor: chrome.text,
      },
      grid: {
        vertLines: { color: chrome.grid },
        horzLines: { color: chrome.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: chrome.border,
      },
      timeScale: {
        borderColor: chrome.border,
        timeVisible: true,
        secondsVisible: false,
        // Bears Bot (MA200) boxes can run right up to the latest candle (ongoing
        // trades reach today, so there are no future bars to pad with). Reserve
        // blank bars on the right so the box's right edge isn't flush against the
        // chart edge. fitContent() honours this offset.
        rightOffset: data.ma200 && data.ma200.length > 0 ? 15 : 0,
      },
      handleScroll: true,
      handleScale: true,
    })
    chartRef.current = chart

    const candleSeries = chart.addCandlestickSeries({
      upColor: COLORS.candleUp,
      downColor: COLORS.candleDown,
      borderUpColor: COLORS.candleUp,
      borderDownColor: COLORS.candleDown,
      wickUpColor: COLORS.candleUp,
      wickDownColor: COLORS.candleDown,
    })
    candleSeries.setData(data.candles as CandlestickData<Time>[])
    candleRef.current = candleSeries

    if (data.psar && data.psar.length > 0) {
      const psarSeries = chart.addLineSeries({
        color: COLORS.psar,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        pointMarkersVisible: true,
      })
      psarSeries.setData(data.psar as LineData<Time>[])
    }
    if (data.ma10 && data.ma10.length > 0) {
      const ma10Series = chart.addLineSeries({
        color: COLORS.ma10,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: false,
        title: 'MA 10',
      })
      ma10Series.setData(data.ma10 as LineData<Time>[])
    }
    if (data.ma200 && data.ma200.length > 0) {
      const ma200Series = chart.addLineSeries({
        color: COLORS.ma200,
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        crosshairMarkerVisible: true,
        lastValueVisible: true,
        priceLineVisible: false,
        title: 'MA 200',
      })
      ma200Series.setData(data.ma200 as LineData<Time>[])
    }

    if (data.avg_buy != null) {
      const avgBuySeries = chart.addLineSeries({
        color: COLORS.avgBuy,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: true,
        priceLineVisible: false,
        title: `Avg Buy ${data.avg_buy.toFixed(2)}`,
      })
      const first = data.candles[0]?.time
      const last = data.candles[data.candles.length - 1]?.time
      if (first && last) {
        avgBuySeries.setData([
          { time: first as Time, value: data.avg_buy },
          { time: last as Time, value: data.avg_buy },
        ])
      }
    }

    if (data.avg_sell != null) {
      const avgSellSeries = chart.addLineSeries({
        color: COLORS.avgSell,
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        lastValueVisible: true,
        priceLineVisible: false,
        title: `Avg Sell ${data.avg_sell.toFixed(2)}`,
      })
      const first = data.candles[0]?.time
      const last = data.candles[data.candles.length - 1]?.time
      if (first && last) {
        avgSellSeries.setData([
          { time: first as Time, value: data.avg_sell },
          { time: last as Time, value: data.avg_sell },
        ])
      }
    }

    const aggregateMarkers = (markers: typeof data.buy_markers) => {
      const byTime = new Map<string, { time: string; price: number; qty: number }>()
      for (const m of markers) {
        const cur = byTime.get(m.time)
        if (cur) {
          cur.price = (cur.price * cur.qty + m.price * m.qty) / (cur.qty + m.qty)
          cur.qty += m.qty
        } else {
          byTime.set(m.time, { time: m.time, price: m.price, qty: m.qty })
        }
      }
      return [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : 1))
    }

    const pins: PinMarker[] = [
      ...aggregateMarkers(data.buy_markers).map((m) => ({
        time: m.time,
        price: m.price,
        side: 'buy' as const,
        label: `B ${m.price.toFixed(2)}`,
      })),
      ...aggregateMarkers(data.sell_markers).map((m) => ({
        time: m.time,
        price: m.price,
        side: 'sell' as const,
        label: `S ${m.price.toFixed(2)}`,
      })),
    ]
    const pinHighlight: PinHighlight | null = highlightExec
      ? { time: highlightExec.date, side: highlightExec.side }
      : null
    if (pins.length > 0) {
      candleSeries.attachPrimitive(
        new PinMarkerPrimitive(pins, { buy: COLORS.buy, sell: COLORS.sell }, pinHighlight),
      )
    }

    const sidesByDate = new Map<string, { buy: boolean; sell: boolean }>()
    for (const m of data.buy_markers) {
      const e = sidesByDate.get(m.time) ?? { buy: false, sell: false }
      e.buy = true
      sidesByDate.set(m.time, e)
    }
    for (const m of data.sell_markers) {
      const e = sidesByDate.get(m.time) ?? { buy: false, sell: false }
      e.sell = true
      sidesByDate.set(m.time, e)
    }
    const execMarks = [...sidesByDate.entries()].map(([time, s]) => ({
      time,
      color: s.buy && s.sell ? COLORS.mixed : s.buy ? COLORS.buy : COLORS.sell,
    }))
    if (execMarks.length > 0) {
      candleSeries.attachPrimitive(new ExecDateHighlightPrimitive(execMarks))
    }

    // ── Selected-execution accent line + badge ───────────────────────────────
    // The execution the user clicked in the Executions table: dashed vertical
    // line through the chart at its date with a side/price badge, so a trade
    // with many executions still shows which one was picked.
    if (highlightExec) {
      const color = highlightExec.side === 'buy' ? COLORS.buy : COLORS.sell
      const sideLabel = highlightExec.side === 'buy' ? 'Buy' : 'Sell'
      candleSeries.attachPrimitive(
        new SelectedExecLinePrimitive({
          time: highlightExec.date,
          label: `${sideLabel} @ ${highlightExec.price.toFixed(4)}`,
          color,
        }),
      )
    }

    // ── Quartile boxes as bounded rectangles ────────────────────────────────
    // Drawn via a custom series primitive (canvas) so each box is bounded to
    // its trend block (left_date..right_date) with fill, border, dividers and
    // Q labels — matching _draw_quartile_box in the matplotlib reference.
    if (data.quartile_boxes.length > 0) {
      candleSeries.attachPrimitive(new QuartileBoxPrimitive(data.quartile_boxes))
    }

    // ── Per-candle profit % vs. avg buy ─────────────────────────────────────
    // Only shown for candles after the last execution (buy or sell) — i.e.
    // the unrealized run following the most recent trade activity.
    if (showProfitPct && data.avg_buy != null && data.avg_buy !== 0) {
      const avgBuy = data.avg_buy
      const allExecTimes = [...data.buy_markers, ...data.sell_markers].map((m) => m.time)
      const lastExecTime =
        allExecTimes.length > 0 ? allExecTimes.sort()[allExecTimes.length - 1] : undefined
      const points = data.candles
        .filter((c) => lastExecTime == null || c.time > lastExecTime)
        .map((c) => ({
          time: c.time,
          high: c.high,
          pct: ((c.high - avgBuy) / avgBuy) * 100,
        }))
      candleSeries.attachPrimitive(
        new ProfitPctPrimitive(points, { positive: COLORS.candleUp, negative: '#ff9800' }),
      )
    }

    chart.timeScale().fitContent()

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
    }
  }, [data, highlightExec, showProfitPct, theme])

  return <div ref={containerRef} className="w-full h-full" />
}
