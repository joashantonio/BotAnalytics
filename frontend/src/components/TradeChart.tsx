import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  createChart,
  CrosshairMode,
  LineStyle,
  isBusinessDay,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
  type MouseEventParams,
} from 'lightweight-charts'
import type { ChartData, SelectedExec } from '../types'
import { QuartileBoxPrimitive, type QuartileBox, type QuartileBoxEdge } from './QuartileBoxPrimitive'
import { PinMarkerPrimitive, type PinMarker, type PinHighlight } from './PinMarkerPrimitive'
import { ExecDateHighlightPrimitive } from './ExecDateHighlightPrimitive'
import { SelectedExecLinePrimitive } from './SelectedExecLinePrimitive'
import { ProfitPctPrimitive } from './ProfitPctPrimitive'
import { PriceRangePrimitive, type PriceRangeBox } from './PriceRangePrimitive'
import { chartChrome } from '../lib/chartTheme'
import { api } from '../api/client'

interface Props {
  data: ChartData
  /** Execution picked from the Executions table to emphasise; null otherwise. */
  highlightExec?: SelectedExec | null
  /** When true, show each candle's profit % vs. avg buy: (high - avgBuy) / avgBuy * 100. */
  showProfitPct?: boolean
  /** When true, click-drag on the chart draws a Price Range box (high/low/Δ%). */
  drawPriceRange?: boolean
  /** Called whenever the number of drawn Price Range boxes changes. */
  onPriceRangeCountChange?: (count: number) => void
  /** App theme; passed so the chart re-creates with matching chrome on toggle. */
  theme?: 'dark' | 'light'
  /** Identifiers needed to persist a manually-edited quartile box. Omit to disable editing. */
  sessionId?: string
  symbol?: string
  tradeId?: string
  mode?: 'psar' | 'ma10' | 'ma200'
}

export interface TradeChartHandle {
  /** Removes all drawn Price Range boxes. */
  clearPriceRanges: () => void
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

const TradeChart = forwardRef<TradeChartHandle, Props>(function TradeChart(
  { data, highlightExec, showProfitPct, drawPriceRange, onPriceRangeCountChange, theme, sessionId, symbol, tradeId, mode },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const priceRangePrimitiveRef = useRef<PriceRangePrimitive | null>(null)
  const priceRangeBoxesRef = useRef<PriceRangeBox[]>([])
  const dragStartRef = useRef<{ time: Time; price: number } | null>(null)
  const quartileBoxPrimitiveRef = useRef<QuartileBoxPrimitive | null>(null)
  const quartileBoxesRef = useRef<QuartileBox[]>([])
  const boxEdgeDragRef = useRef<{ boxIndex: number; edge: QuartileBoxEdge } | null>(null)

  const setPriceRangeBoxes = (boxes: PriceRangeBox[]) => {
    priceRangeBoxesRef.current = boxes
    priceRangePrimitiveRef.current?.setBoxes(boxes)
    onPriceRangeCountChange?.(boxes.length)
  }

  useImperativeHandle(ref, () => ({
    clearPriceRanges: () => setPriceRangeBoxes([]),
  }))

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
    priceRangeBoxesRef.current = []
    onPriceRangeCountChange?.(0)

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
    quartileBoxesRef.current = data.quartile_boxes
    if (data.quartile_boxes.length > 0) {
      const lastCandleTimes = data.candles.slice(-2).map((c) => c.time)
      const quartileBoxPrimitive = new QuartileBoxPrimitive(data.quartile_boxes, lastCandleTimes)
      candleSeries.attachPrimitive(quartileBoxPrimitive)
      quartileBoxPrimitiveRef.current = quartileBoxPrimitive
    }

    // ── Per-candle profit % vs. avg buy ─────────────────────────────────────
    // Shown for candles after the last buy, up to (and excluding) the next
    // sell after it if one exists — that span is the position's open run. A
    // sell closes the position out, so there's no open profit past it.
    if (showProfitPct && data.avg_buy != null && data.avg_buy !== 0) {
      const avgBuy = data.avg_buy
      const buyTimes = data.buy_markers.map((m) => m.time).sort()
      const sellTimes = data.sell_markers.map((m) => m.time).sort()
      const lastBuyTime = buyTimes.length > 0 ? buyTimes[buyTimes.length - 1] : undefined
      const sellAfterLastBuy =
        lastBuyTime != null ? sellTimes.find((t) => t > lastBuyTime) : undefined
      const points = data.candles
        .filter(
          (c) =>
            lastBuyTime != null &&
            c.time > lastBuyTime &&
            (sellAfterLastBuy == null || c.time < sellAfterLastBuy),
        )
        .map((c) => ({
          time: c.time,
          high: c.high,
          pct: ((c.high - avgBuy) / avgBuy) * 100,
        }))
      candleSeries.attachPrimitive(
        new ProfitPctPrimitive(points, { positive: COLORS.candleUp, negative: '#ff9800' }),
      )
    }

    const priceRangePrimitive = new PriceRangePrimitive(priceRangeBoxesRef.current, COLORS.psar)
    candleSeries.attachPrimitive(priceRangePrimitive)
    priceRangePrimitiveRef.current = priceRangePrimitive

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
      priceRangePrimitiveRef.current = null
      quartileBoxPrimitiveRef.current = null
    }
  }, [data, highlightExec, showProfitPct, theme])

  // ── Price Range draw mode ───────────────────────────────────────────────
  // lightweight-charts has no native drag gesture, so a box is placed with
  // two clicks: first click sets the anchor corner, mouse move previews the
  // box, second click commits it. Boxes accumulate until the underlying
  // chart data changes (new trade/symbol).
  useEffect(() => {
    const chart = chartRef.current
    const series = candleRef.current
    if (!chart || !series || !drawPriceRange) return

    const toPoint = (param: MouseEventParams<Time>) => {
      if (param.time == null || param.point == null) return null
      const price = series.coordinateToPrice(param.point.y)
      if (price == null) return null
      return { time: param.time, price }
    }

    const handleMove = (param: MouseEventParams<Time>) => {
      if (!dragStartRef.current) return
      const point = toPoint(param)
      if (!point) return
      const preview: PriceRangeBox = {
        time1: dragStartRef.current.time,
        price1: dragStartRef.current.price,
        time2: point.time,
        price2: point.price,
      }
      priceRangePrimitiveRef.current?.setBoxes([...priceRangeBoxesRef.current, preview])
    }

    const handleClick = (param: MouseEventParams<Time>) => {
      const point = toPoint(param)
      if (!point) return

      if (!dragStartRef.current) {
        // Not mid-placement: clicking an existing box removes it (direct
        // manipulation); otherwise this click anchors a new box.
        const hitIndex = param.point
          ? priceRangePrimitiveRef.current?.findBoxAt(param.point.x, param.point.y) ?? -1
          : -1
        if (hitIndex >= 0) {
          setPriceRangeBoxes(priceRangeBoxesRef.current.filter((_, i) => i !== hitIndex))
          return
        }
        dragStartRef.current = point
        return
      }

      const box: PriceRangeBox = {
        time1: dragStartRef.current.time,
        price1: dragStartRef.current.price,
        time2: point.time,
        price2: point.price,
      }
      setPriceRangeBoxes([...priceRangeBoxesRef.current, box])
      dragStartRef.current = null
    }

    chart.subscribeClick(handleClick)
    chart.subscribeCrosshairMove(handleMove)

    return () => {
      chart.unsubscribeClick(handleClick)
      chart.unsubscribeCrosshairMove(handleMove)
      dragStartRef.current = null
      priceRangePrimitiveRef.current?.setBoxes(priceRangeBoxesRef.current)
    }
  }, [drawPriceRange, data])

  // ── Quartile box edge resize ────────────────────────────────────────────
  // Dragging the top/bottom border of a green quartile box adjusts price_hi
  // /price_lo; dragging the right (time) border adjusts right_date. Live
  // while dragging; on release the new bounds are persisted via the
  // box-override endpoint so they survive a reload. Disabled while the
  // Price Range tool is active (drawPriceRange) to avoid gesture conflicts,
  // and when the identifiers needed to save aren't supplied.
  useEffect(() => {
    const container = containerRef.current
    const chart = chartRef.current
    const series = candleRef.current
    const primitive = quartileBoxPrimitiveRef.current
    if (!container || !chart || !series || !primitive || drawPriceRange) return
    if (!sessionId || !symbol || !tradeId || !mode) return

    const getRelativeXY = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    // lightweight-charts represents a date-string series' time as a
    // BusinessDay ({year, month, day}); left_date/right_date are plain
    // "YYYY-MM-DD" strings, so convert back to that shape after a drag.
    const businessDayToIso = (time: Time): string | null => {
      if (!isBusinessDay(time)) return null
      const mm = String(time.month).padStart(2, '0')
      const dd = String(time.day).padStart(2, '0')
      return `${time.year}-${mm}-${dd}`
    }

    // coordinateToTime() only resolves coordinates that land on an actual
    // bar — it returns null in the blank rightOffset margin past the last
    // candle, which is exactly where an "ongoing" trade's box (today, or
    // close to it) needs to be draggable further right. coordinateToLogical
    // keeps working out there, so fall back to it and extrapolate the date
    // using the spacing between the chart's last two candles.
    const xToIso = (x: number): string | null => {
      const time = chart.timeScale().coordinateToTime(x)
      if (time != null) return businessDayToIso(time)

      const logical = chart.timeScale().coordinateToLogical(x)
      if (logical == null) return null
      const candles = data.candles
      if (candles.length < 2) return null
      const last = new Date(candles[candles.length - 1].time)
      const prev = new Date(candles[candles.length - 2].time)
      const msPerBar = last.getTime() - prev.getTime()
      if (msPerBar <= 0) return null
      const lastLogical = candles.length - 1
      const barsPast = logical - lastLogical
      const ms = last.getTime() + barsPast * msPerBar
      return new Date(ms).toISOString().slice(0, 10)
    }

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y } = getRelativeXY(e)
      if (!boxEdgeDragRef.current) {
        const edge = primitive.findEdgeAt(x, y)
        container.style.cursor = edge ? (edge.edge === 'right' ? 'ew-resize' : 'ns-resize') : ''
        // Disable the chart's own pan/zoom the moment the pointer is over an
        // edge — not at mousedown — since lightweight-charts' pan listener
        // lives on a child canvas and fires before ours (bubble order), so
        // toggling handleScroll/handleScale at mousedown time is too late to
        // stop that drag from starting.
        chart.applyOptions({ handleScroll: !edge, handleScale: !edge })
        return
      }
      const { boxIndex, edge } = boxEdgeDragRef.current
      const boxes = quartileBoxesRef.current.slice()
      const box = { ...boxes[boxIndex] }

      if (edge === 'right') {
        const iso = xToIso(x)
        if (iso == null || iso <= box.left_date) return
        box.right_date = iso
      } else {
        const price = series.coordinateToPrice(y)
        if (price == null) return
        if (edge === 'hi') {
          box.price_hi = Math.max(price, box.price_lo + 0.0001)
        } else {
          box.price_lo = Math.min(price, box.price_hi - 0.0001)
        }
      }

      boxes[boxIndex] = box
      quartileBoxesRef.current = boxes
      primitive.setBoxes(boxes)
    }

    const handleMouseDown = (e: MouseEvent) => {
      const { x, y } = getRelativeXY(e)
      const edge = primitive.findEdgeAt(x, y)
      if (!edge) return
      boxEdgeDragRef.current = edge
      chart.applyOptions({ handleScroll: false, handleScale: false })
      e.preventDefault()
      e.stopPropagation()
    }

    const handleMouseUp = () => {
      const drag = boxEdgeDragRef.current
      if (!drag) return
      boxEdgeDragRef.current = null
      chart.applyOptions({ handleScroll: true, handleScale: true })
      const box = quartileBoxesRef.current[drag.boxIndex]
      api
        .saveBoxOverride(sessionId, symbol, {
          trade_id: tradeId,
          mode,
          box_index: box.box_index,
          price_lo: box.price_lo,
          price_hi: box.price_hi,
          right_date: box.right_date,
        })
        .catch(console.error)
    }

    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mouseup', handleMouseUp)
      container.style.cursor = ''
      if (boxEdgeDragRef.current) {
        chart.applyOptions({ handleScroll: true, handleScale: true })
      }
      boxEdgeDragRef.current = null
    }
  }, [data, drawPriceRange, sessionId, symbol, tradeId, mode])

  return <div ref={containerRef} className="w-full h-full" />
})

export default TradeChart
