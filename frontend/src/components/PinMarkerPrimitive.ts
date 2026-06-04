/**
 * Custom series primitive that draws location-pin markers (teardrop + white
 * hole) at each order's execution price — Lightweight Charts only ships
 * circle/square/arrow marker shapes, so pins are rendered on the canvas.
 *
 * Buy pins are green and sit below the price with the tip pointing up at it;
 * sell pins are red and sit above with the tip pointing down. Matches the
 * _draw_pin helper in the matplotlib reference.
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

export interface PinMarker {
  time: string
  price: number
  side: 'buy' | 'sell'
  label: string
}

const HEAD_RADIUS = 11 // px — radius of the round pin head
const HOLE_RADIUS = 4.5 // px — white hole in the head
const TAIL_LEN = HEAD_RADIUS * 2.6 // px — tip distance from the head centre
const TIP_GAP = 1 // px between pin tip and the exact price

interface MediaScope {
  context: CanvasRenderingContext2D
}

function drawPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  yPrice: number,
  color: string,
  pointsUp: boolean,
) {
  // pointsUp: tip at the bottom (price), head above → buy below bar
  // !pointsUp: tip at the top (price), head below → sell above bar
  // dir points from the tip toward the head centre.
  const dir = pointsUp ? -1 : 1
  const tipY = yPrice + dir * -TIP_GAP
  const headCY = tipY + dir * TAIL_LEN

  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'

  // Classic map-pin teardrop = circle head + two straight tails tangent to the
  // circle meeting at the tip. Tangent contact angle (from head centre, off the
  // centre→tip axis) = acos(r / d), where d = centre-to-tip distance.
  // axis = angle (canvas coords, +y down) from the head centre toward the tip:
  //   buy/down-pointing head sits above tip → tip at +y → axis = +π/2.
  const d = TAIL_LEN
  const axis = dir < 0 ? Math.PI / 2 : -Math.PI / 2
  const phi = Math.acos(HEAD_RADIUS / d) // contact half-angle at the centre
  const cLeft = axis - phi
  const cRight = axis + phi

  ctx.beginPath()
  ctx.moveTo(x, tipY)
  // tip → left contact point on the circle (straight tangent)
  ctx.lineTo(x + HEAD_RADIUS * Math.cos(cLeft), headCY + HEAD_RADIUS * Math.sin(cLeft))
  // arc the long way around the head (away from the tip) to the right contact
  ctx.arc(x, headCY, HEAD_RADIUS, cLeft, cRight, dir < 0)
  // right contact → tip
  ctx.lineTo(x, tipY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // white hole in the head
  ctx.beginPath()
  ctx.arc(x, headCY, HOLE_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  ctx.restore()
}

class PinMarkerRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _pins: PinMarker[],
    private _chart: IChartApi,
    private _series: ISeriesApi<'Candlestick'>,
    private _colors: { buy: string; sell: string },
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const timeScale = this._chart.timeScale()
      for (const pin of this._pins) {
        const x = timeScale.timeToCoordinate(pin.time as Time)
        const y = this._series.priceToCoordinate(pin.price)
        if (x == null || y == null) continue
        const isBuy = pin.side === 'buy'
        const color = isBuy ? this._colors.buy : this._colors.sell
        // both pins point down (tip at price, head above) like the reference
        drawPin(ctx, x, y, color, true)

        // price label beside the pin head (above the tip)
        const headCY = y - TAIL_LEN
        ctx.save()
        ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = color
        ctx.fillText(pin.label, x + HEAD_RADIUS + 5, headCY)
        ctx.restore()
      }
    })
  }
}

class PinMarkerPaneView implements ISeriesPrimitivePaneView {
  private _renderer: PinMarkerRenderer

  constructor(
    pins: PinMarker[],
    chart: IChartApi,
    series: ISeriesApi<'Candlestick'>,
    colors: { buy: string; sell: string },
  ) {
    this._renderer = new PinMarkerRenderer(pins, chart, series, colors)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

export class PinMarkerPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: PinMarkerPaneView[] = []
  private _pins: PinMarker[]
  private _colors: { buy: string; sell: string }
  private _requestUpdate?: () => void

  constructor(pins: PinMarker[], colors: { buy: string; sell: string }) {
    this._pins = pins
    this._colors = colors
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._requestUpdate = param.requestUpdate
    this._paneViews = [
      new PinMarkerPaneView(
        this._pins,
        param.chart,
        param.series as ISeriesApi<'Candlestick'>,
        this._colors,
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
