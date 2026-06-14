import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts'

export interface ProfitPctPoint {
  time: string
  high: number
  pct: number
}

export interface ProfitPctColors {
  positive: string
  negative: string
}

const LABEL_OFFSET = 4 // px above the candle's high

interface MediaScope {
  context: CanvasRenderingContext2D
}

class ProfitPctRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _points: ProfitPctPoint[],
    private _chart: IChartApi,
    private _series: ISeriesApi<'Candlestick'>,
    private _colors: ProfitPctColors,
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const timeScale = this._chart.timeScale()
      ctx.save()
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      for (const point of this._points) {
        const x = timeScale.timeToCoordinate(point.time as Time)
        const y = this._series.priceToCoordinate(point.high)
        if (x == null || y == null) continue
        ctx.fillStyle = point.pct >= 0 ? this._colors.positive : this._colors.negative
        ctx.fillText(`${point.pct.toFixed(2)}%`, x, y - LABEL_OFFSET)
      }
      ctx.restore()
    })
  }
}

class ProfitPctPaneView implements ISeriesPrimitivePaneView {
  private _renderer: ProfitPctRenderer

  constructor(
    points: ProfitPctPoint[],
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    colors: ProfitPctColors,
  ) {
    this._renderer = new ProfitPctRenderer(points, chart, series, colors)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

export class ProfitPctPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: ProfitPctPaneView[] = []
  private _points: ProfitPctPoint[]
  private _colors: ProfitPctColors
  private _requestUpdate?: () => void

  constructor(points: ProfitPctPoint[], colors: ProfitPctColors) {
    this._points = points
    this._colors = colors
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._requestUpdate = param.requestUpdate
    this._paneViews = [
      new ProfitPctPaneView(this._points, param.chart, param.series as ISeriesApi<'Candlestick'>, this._colors),
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
