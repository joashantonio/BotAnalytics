import { useEffect, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from 'lightweight-charts'
import type { ChartData } from '../types'
import { QuartileBoxPrimitive } from './QuartileBoxPrimitive'
import { PinMarkerPrimitive, type PinMarker } from './PinMarkerPrimitive'
import { ExecDateHighlightPrimitive } from './ExecDateHighlightPrimitive'

interface Props {
  data: ChartData
}

const COLORS = {
  bg: '#1a1d23',
  grid: '#2d3240',
  text: '#94a3b8',
  border: '#2d3240',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
  psar: '#f57f17',
  buy: '#00c853',
  sell: '#f44336',
  avgBuy: '#ffd600',
  avgSell: '#9c27b0',
  volUp: '#a5d6a7',
  volDown: '#ef9a9a',
  lastClose: '#90caf9',
  mixed: '#1565c0',
}

export default function TradeChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: COLORS.bg },
        textColor: COLORS.text,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: COLORS.border,
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    })
    chartRef.current = chart

    // ── Candlestick series ──────────────────────────────────────────────────
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

    // ── Volume histogram (separate pane) ────────────────────────────────────
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    })
    volSeries.setData(data.volume as HistogramData<Time>[])

    // ── PSAR dots ───────────────────────────────────────────────────────────
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

    // ── Average buy line ───────────────────────────────────────────────────
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

    // ── Average sell line ──────────────────────────────────────────────────
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

    // Lightweight Charts requires series data to be strictly ascending and
    // unique by time. Multiple orders can execute on the same bar, so collapse
    // same-bar markers into one qty-weighted point before plotting — otherwise
    // setData throws "data must be asc ordered by time" and the chart blanks.
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

    // ── Buy / sell pin markers ───────────────────────────────────────────────
    // Drawn as location pins (green buy / red sell) via a custom primitive —
    // Lightweight Charts only offers circle/square/arrow shapes. Same-bar orders
    // are collapsed to one qty-weighted pin first.
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
    if (pins.length > 0) {
      candleSeries.attachPrimitive(
        new PinMarkerPrimitive(pins, { buy: COLORS.buy, sell: COLORS.sell }),
      )
    }

    // ── Exec-date highlights on the time axis ────────────────────────────────
    // blue = buy + sell same day, green = buy only, red = sell only.
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

    // ── Quartile boxes as bounded rectangles ────────────────────────────────
    // Drawn via a custom series primitive (canvas) so each box is bounded to
    // its trend block (left_date..right_date) with fill, border, dividers and
    // Q labels — matching _draw_quartile_box in the matplotlib reference.
    if (data.quartile_boxes.length > 0) {
      candleSeries.attachPrimitive(new QuartileBoxPrimitive(data.quartile_boxes))
    }

    // fit content
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
  }, [data])

  return <div ref={containerRef} className="w-full h-full" />
}
