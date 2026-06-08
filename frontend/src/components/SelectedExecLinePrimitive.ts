/**
 * Custom series primitive that draws a bright vertical accent line at the date
 * of the execution the user picked in the Executions table, plus a badge naming
 * the side and price. Makes the specific execution unmistakable on a chart that
 * may show many pins for the same trade.
 */
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  IChartApi,
} from 'lightweight-charts'

export interface SelectedExecLine {
  time: string
  label: string
  color: string
}

interface MediaScope {
  context: CanvasRenderingContext2D
  mediaSize: { width: number; height: number }
}

class SelectedExecLineRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _line: SelectedExecLine,
    private _chart: IChartApi,
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const x = this._chart.timeScale().timeToCoordinate(this._line.time as Time)
      if (x == null) return
      const w = scope.mediaSize.width
      ctx.save()

      // dashed accent line through the full chart height
      ctx.strokeStyle = this._line.color
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, scope.mediaSize.height)
      ctx.stroke()
      ctx.setLineDash([])

      // badge at the top — clamped so it stays on-screen near the edges
      ctx.font = 'bold 11px sans-serif'
      const padX = 6
      const textW = ctx.measureText(this._line.label).width
      const badgeW = textW + padX * 2
      const badgeH = 18
      let bx = x + 6
      if (bx + badgeW > w) bx = x - 6 - badgeW
      const by = 6

      ctx.fillStyle = this._line.color
      ctx.fillRect(bx, by, badgeW, badgeH)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(this._line.label, bx + padX, by + badgeH / 2)

      ctx.restore()
    })
  }
}

class SelectedExecLinePaneView implements ISeriesPrimitivePaneView {
  private _renderer: SelectedExecLineRenderer

  constructor(line: SelectedExecLine, chart: IChartApi) {
    this._renderer = new SelectedExecLineRenderer(line, chart)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

export class SelectedExecLinePrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: SelectedExecLinePaneView[] = []
  private _line: SelectedExecLine
  private _requestUpdate?: () => void

  constructor(line: SelectedExecLine) {
    this._line = line
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._requestUpdate = param.requestUpdate
    this._paneViews = [new SelectedExecLinePaneView(this._line, param.chart)]
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
