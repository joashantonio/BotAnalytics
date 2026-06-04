/**
 * Custom series primitive that draws a bounded quartile rectangle on the
 * candlestick series — the Lightweight Charts v4 free tier has no rectangle
 * primitive, so we render directly onto the chart canvas.
 *
 * Mirrors _draw_quartile_box in completed_trades_fetcher.py:
 *   - translucent fill + solid border between price_lo..price_hi
 *   - 3 dashed dividers at 25/50/75%
 *   - Q labels at the 12.5/37.5/62.5/87.5% band midpoints
 *     buy block: Q1 (bottom) → Q4 (top); sell block: Q1 (top) → Q4 (bottom)
 * bounded horizontally by left_date..right_date instead of spanning the chart.
 */
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

class QuartileBoxRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _boxes: QuartileBox[],
    private _chart: IChartApi,
    private _series: ISeriesApi<'Candlestick'>,
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const timeScale = this._chart.timeScale()

      for (const box of this._boxes) {
        const xLeft = timeScale.timeToCoordinate(box.left_date as Time)
        const xRight = timeScale.timeToCoordinate(box.right_date as Time)
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

        // translucent fill
        ctx.fillStyle = hexToRgba(box.color, 0.12)
        ctx.fillRect(x0, yTop, w, h)

        // solid border
        ctx.strokeStyle = box.color
        ctx.lineWidth = 1
        ctx.setLineDash([])
        ctx.strokeRect(x0, yTop, w, h)

        // 25/50/75% dividers (dashed) — q_levels already in price space
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

        // band-midpoint Q labels. price_lo→price_hi maps bottom→top in price,
        // i.e. high price = small y. Buy: Q1 at low price (bottom of band stack).
        // Sell: Q1 at high price (top), so reverse label order.
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

  constructor(boxes: QuartileBox[], chart: IChartApi, series: ISeriesApi<'Candlestick'>) {
    this._renderer = new QuartileBoxRenderer(boxes, chart, series)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

export class QuartileBoxPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: QuartileBoxPaneView[] = []
  private _boxes: QuartileBox[]
  private _requestUpdate?: () => void

  constructor(boxes: QuartileBox[]) {
    this._boxes = boxes
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._requestUpdate = param.requestUpdate
    this._paneViews = [
      new QuartileBoxPaneView(
        this._boxes,
        param.chart,
        param.series as ISeriesApi<'Candlestick'>,
      ),
    ]
    this._requestUpdate?.()
  }

  detached(): void {
    this._paneViews = []
    this._requestUpdate = undefined
  }

  updateAllViews(): void {}

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews
  }
}
