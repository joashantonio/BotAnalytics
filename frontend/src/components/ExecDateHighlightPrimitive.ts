
import type {
  ISeriesPrimitive,
  ISeriesPrimitivePaneView,
  ISeriesPrimitivePaneRenderer,
  SeriesAttachedParameter,
  Time,
  IChartApi,
} from 'lightweight-charts'

export interface ExecDateMark {
  time: string
  color: string
}

const BAND_HEIGHT = 6
const BAND_WIDTH = 11
const COLUMN_ALPHA = 0.10

interface MediaScope {
  context: CanvasRenderingContext2D
  mediaSize: { width: number; height: number }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`
}

class ExecDateHighlightRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(
    private _marks: ExecDateMark[],
    private _chart: IChartApi,
  ) {}

  draw(target: { useMediaCoordinateSpace: (cb: (scope: MediaScope) => void) => void }) {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const timeScale = this._chart.timeScale()
      const h = scope.mediaSize.height
      ctx.save()
      for (const m of this._marks) {
        const x = timeScale.timeToCoordinate(m.time as Time)
        if (x == null) continue

        ctx.fillStyle = hexToRgba(m.color, COLUMN_ALPHA)
        ctx.fillRect(x - BAND_WIDTH / 2, 0, BAND_WIDTH, h)

        ctx.fillStyle = m.color
        ctx.fillRect(x - BAND_WIDTH / 2, h - BAND_HEIGHT, BAND_WIDTH, BAND_HEIGHT)
      }
      ctx.restore()
    })
  }
}

class ExecDateHighlightPaneView implements ISeriesPrimitivePaneView {
  private _renderer: ExecDateHighlightRenderer

  constructor(marks: ExecDateMark[], chart: IChartApi) {
    this._renderer = new ExecDateHighlightRenderer(marks, chart)
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return this._renderer
  }
}

export class ExecDateHighlightPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: ExecDateHighlightPaneView[] = []
  private _marks: ExecDateMark[]
  private _requestUpdate?: () => void

  constructor(marks: ExecDateMark[]) {
    this._marks = marks
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._requestUpdate = param.requestUpdate
    this._paneViews = [new ExecDateHighlightPaneView(this._marks, param.chart)]
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
