
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts'

export interface QuartileBox {
  box_index: number
  side: 'buy' | 'sell'
  color: string
  price_lo: number
  price_hi: number
  q_levels: number[]
  left_date: string
  right_date: string
}

const BAND_MIDS = [0.125, 0.375, 0.625, 0.875]

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * timeToCoordinate() returns null for any date past the last real candle
 * (e.g. the blank rightOffset margin reserved for an ongoing trade's box).
 * Falls back to extrapolating from the last two candles' spacing so boxes
 * whose right_date sits at or beyond "today" still render/hit-test there.
 */
function dateToCoordinate(
  timeScale: ReturnType<IChartApi['timeScale']>,
  lastCandleTimes: readonly string[],
  dateIso: string,
): number | null {
  const direct = timeScale.timeToCoordinate(dateIso as Time)
  if (direct != null) return direct
  if (lastCandleTimes.length < 2) return null

  const last = lastCandleTimes[lastCandleTimes.length - 1]
  const prev = lastCandleTimes[lastCandleTimes.length - 2]
  const lastCoord = timeScale.timeToCoordinate(last as Time)
  const prevCoord = timeScale.timeToCoordinate(prev as Time)
  if (lastCoord == null || prevCoord == null) return null

  const msPerBar = new Date(last).getTime() - new Date(prev).getTime()
  if (msPerBar <= 0) return null
  const pxPerBar = lastCoord - prevCoord
  const barsPast = (new Date(dateIso).getTime() - new Date(last).getTime()) / msPerBar
  return lastCoord + barsPast * pxPerBar
}

class QuartileBoxRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _boxes: QuartileBox[],
    private _chart: IChartApi,
    private _series: ISeriesApi<'Candlestick'>,
    private _lastCandleTimes: readonly string[],
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const timeScale = this._chart.timeScale()

      for (const box of this._boxes) {
        const xLeft = dateToCoordinate(timeScale, this._lastCandleTimes, box.left_date)
        const xRight = dateToCoordinate(timeScale, this._lastCandleTimes, box.right_date)
        const yHi = this._series.priceToCoordinate(box.price_hi)
        const yLo = this._series.priceToCoordinate(box.price_lo)
        if (xLeft == null || xRight == null || yHi == null || yLo == null) continue

        const x0 = Math.min(xLeft, xRight)
        const x1 = Math.max(xLeft, xRight)
        const yTop = Math.min(yHi, yLo)
        const yBot = Math.max(yHi, yLo)
        const w = Math.max(x1 - x0, 1)
        const h = yBot - yTop
        if (h <= 0) continue

        ctx.fillStyle = hexToRgba(box.color, 0.12)
        ctx.fillRect(x0, yTop, w, h)

        ctx.strokeStyle = box.color
        ctx.lineWidth = 1
        ctx.setLineDash([])
        ctx.strokeRect(x0, yTop, w, h)

        ctx.setLineDash([4, 3])
        ctx.globalAlpha = 0.55
        for (const lvl of box.q_levels) {
          const y = this._series.priceToCoordinate(lvl)
          if (y == null) continue
          ctx.beginPath()
          ctx.moveTo(x0, y)
          ctx.lineTo(x1, y)
          ctx.stroke()
        }
        ctx.setLineDash([])
        ctx.globalAlpha = 1

        const labels = box.side === 'buy'
          ? ['Q1', 'Q2', 'Q3', 'Q4']
          : ['Q4', 'Q3', 'Q2', 'Q1']
        const range = box.price_hi - box.price_lo
        ctx.fillStyle = box.color
        ctx.font = 'bold 10px sans-serif'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'left'
        BAND_MIDS.forEach((frac, i) => {
          const price = box.price_lo + frac * range
          const y = this._series.priceToCoordinate(price)
          if (y == null) return
          ctx.fillText(labels[i], x0 + 4, y)
        })
      }
    })
  }
}

interface MediaScope {
  context: CanvasRenderingContext2D
}

class QuartileBoxPaneView implements ISeriesPrimitivePaneView {
  private _renderer: QuartileBoxRenderer

  constructor(
    boxes: QuartileBox[],
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    lastCandleTimes: readonly string[],
  ) {
    this._renderer = new QuartileBoxRenderer(boxes, chart, series, lastCandleTimes)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

/** Pixels of slack around an edge that still counts as a hit. */
const EDGE_HIT_PX = 5

export type QuartileBoxEdge = 'lo' | 'hi' | 'right'

export class QuartileBoxPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: QuartileBoxPaneView[] = []
  private _boxes: QuartileBox[]
  private _requestUpdate?: () => void
  private _chart?: IChartApi
  private _series?: ISeriesApi<'Candlestick'>
  /** Last two candle times, used to extrapolate dates past the chart's data range. */
  private _lastCandleTimes: readonly string[]

  constructor(boxes: QuartileBox[], lastCandleTimes: readonly string[] = []) {
    this._boxes = boxes
    this._lastCandleTimes = lastCandleTimes
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._requestUpdate = param.requestUpdate
    this._chart = param.chart
    this._series = param.series as ISeriesApi<'Candlestick'>
    this._rebuildViews()
    this._requestUpdate?.()
  }

  detached(): void {
    this._paneViews = []
    this._requestUpdate = undefined
  }

  setBoxes(boxes: QuartileBox[]): void {
    this._boxes = boxes
    this._rebuildViews()
    this._requestUpdate?.()
  }

  /**
   * Finds the box edge under (x, y) in pixel space, if any. Used to show a
   * resize cursor and to start an edge-drag. Checks the right (time) edge
   * first since it's a thin vertical line that the wider top/bottom hit
   * zones could otherwise mask near the corner. Returns null when no edge
   * is within EDGE_HIT_PX of the pointer.
   */
  findEdgeAt(x: number, y: number): { boxIndex: number; edge: QuartileBoxEdge } | null {
    if (!this._chart || !this._series) return null
    const timeScale = this._chart.timeScale()
    for (let i = this._boxes.length - 1; i >= 0; i--) {
      const box = this._boxes[i]
      const xLeft = dateToCoordinate(timeScale, this._lastCandleTimes, box.left_date)
      const xRight = dateToCoordinate(timeScale, this._lastCandleTimes, box.right_date)
      const yHi = this._series.priceToCoordinate(box.price_hi)
      const yLo = this._series.priceToCoordinate(box.price_lo)
      if (xLeft == null || xRight == null || yHi == null || yLo == null) continue
      const x0 = Math.min(xLeft, xRight)
      const x1 = Math.max(xLeft, xRight)
      const yTop = Math.min(yHi, yLo)
      const yBot = Math.max(yHi, yLo)
      if (y < yTop - EDGE_HIT_PX || y > yBot + EDGE_HIT_PX) continue

      if (Math.abs(x - x1) <= EDGE_HIT_PX) {
        return { boxIndex: i, edge: 'right' }
      }
      // eslint-disable-next-line no-console
      console.debug('[quartile-debug]', { x, y, x0, x1, yTop, yBot, dxRight: x - x1 })
      if (x < x0 || x > x1) continue

      if (Math.abs(y - yTop) <= EDGE_HIT_PX) {
        return { boxIndex: i, edge: yTop === yHi ? 'hi' : 'lo' }
      }
      if (Math.abs(y - yBot) <= EDGE_HIT_PX) {
        return { boxIndex: i, edge: yBot === yHi ? 'hi' : 'lo' }
      }
    }
    return null
  }

  private _rebuildViews(): void {
    if (!this._chart || !this._series) return
    this._paneViews = [
      new QuartileBoxPaneView(this._boxes, this._chart, this._series, this._lastCandleTimes),
    ]
  }

  updateAllViews(): void {}

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews
  }
}
