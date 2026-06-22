import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts'

export interface PriceRangeBox {
  time1: Time
  time2: Time
  price1: number
  price2: number
}

interface MediaScope {
  context: CanvasRenderingContext2D
}

class PriceRangeRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _boxes: PriceRangeBox[],
    private _chart: IChartApi,
    private _series: ISeriesApi<'Candlestick'>,
    private _color: string,
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const timeScale = this._chart.timeScale()

      for (const box of this._boxes) {
        const x1 = timeScale.timeToCoordinate(box.time1)
        const x2 = timeScale.timeToCoordinate(box.time2)
        const y1 = this._series.priceToCoordinate(box.price1)
        const y2 = this._series.priceToCoordinate(box.price2)
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue

        const xLeft = Math.min(x1, x2)
        const xRight = Math.max(x1, x2)
        const yTop = Math.min(y1, y2)
        const yBot = Math.max(y1, y2)
        const w = Math.max(xRight - xLeft, 1)
        const h = Math.max(yBot - yTop, 1)

        ctx.fillStyle = `${this._color}1f`
        ctx.fillRect(xLeft, yTop, w, h)

        ctx.strokeStyle = this._color
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.strokeRect(xLeft, yTop, w, h)
        ctx.setLineDash([])

        const hi = Math.max(box.price1, box.price2)
        const lo = Math.min(box.price1, box.price2)
        const delta = hi - lo
        const pct = lo !== 0 ? (delta / lo) * 100 : 0

        ctx.fillStyle = this._color
        ctx.font = 'bold 11px sans-serif'
        ctx.textBaseline = 'bottom'
        ctx.textAlign = 'left'
        ctx.fillText(
          `${delta.toFixed(4)} (${pct.toFixed(2)}%)`,
          xLeft + 4,
          yTop - 4 < 12 ? yTop + 14 : yTop - 4,
        )
      }
    })
  }
}

class PriceRangePaneView implements ISeriesPrimitivePaneView {
  private _renderer: PriceRangeRenderer

  constructor(boxes: PriceRangeBox[], chart: IChartApi, series: ISeriesApi<'Candlestick'>, color: string) {
    this._renderer = new PriceRangeRenderer(boxes, chart, series, color)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

export class PriceRangePrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: PriceRangePaneView[] = []
  private _boxes: PriceRangeBox[]
  private _color: string
  private _requestUpdate?: () => void
  private _chart?: IChartApi
  private _series?: ISeriesApi<'Candlestick'>

  constructor(boxes: PriceRangeBox[], color: string) {
    this._boxes = boxes
    this._color = color
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

  setBoxes(boxes: PriceRangeBox[]): void {
    this._boxes = boxes
    this._rebuildViews()
    this._requestUpdate?.()
  }

  /** Index of the topmost box whose rect contains (x, y) in pixel space, or -1. */
  findBoxAt(x: number, y: number): number {
    if (!this._chart || !this._series) return -1
    const timeScale = this._chart.timeScale()
    for (let i = this._boxes.length - 1; i >= 0; i--) {
      const box = this._boxes[i]
      const x1 = timeScale.timeToCoordinate(box.time1)
      const x2 = timeScale.timeToCoordinate(box.time2)
      const y1 = this._series.priceToCoordinate(box.price1)
      const y2 = this._series.priceToCoordinate(box.price2)
      if (x1 == null || x2 == null || y1 == null || y2 == null) continue
      const xLeft = Math.min(x1, x2)
      const xRight = Math.max(x1, x2)
      const yTop = Math.min(y1, y2)
      const yBot = Math.max(y1, y2)
      if (x >= xLeft && x <= xRight && y >= yTop && y <= yBot) return i
    }
    return -1
  }

  private _rebuildViews(): void {
    if (!this._chart || !this._series) return
    this._paneViews = [new PriceRangePaneView(this._boxes, this._chart, this._series, this._color)]
  }

  updateAllViews(): void {}

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this._paneViews
  }
}
