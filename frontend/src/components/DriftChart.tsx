import { useEffect, useRef } from 'react'
import {
  createChart,
  LineStyle,
  type IChartApi,
  type LineData,
  type Time,
} from 'lightweight-charts'
import { chartChrome } from '../lib/chartTheme'

export interface DriftSeries {
  /** YYYY-MM-DD bucket key (representative date), already sorted ascending. */
  time: string
  value: number
}

interface Props {
  maard: DriftSeries[]
  bears: DriftSeries[]
  /** Re-create the chart when the app theme flips so canvas chrome follows. */
  theme?: 'dark' | 'light'
}

const SERIES = {
  maard: '#f57f17', // matches PSAR colour used elsewhere
  bears: '#e91e63', // matches MA200 colour used elsewhere
}

/** Two-line chart of prediction accuracy (%) over time, one line per bot. */
export default function DriftChart({ maard, bears, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chrome = chartChrome(theme)
    const chart = createChart(containerRef.current, {
      layout: { background: { color: chrome.bg }, textColor: chrome.text },
      grid: {
        vertLines: { color: chrome.grid },
        horzLines: { color: chrome.grid },
      },
      rightPriceScale: {
        borderColor: chrome.border,
        // accuracy is a percentage; pin the axis 0–100 for stable comparison
        autoScale: false,
      },
      timeScale: { borderColor: chrome.border, timeVisible: false },
      crosshair: { horzLine: { labelVisible: true }, vertLine: { labelVisible: true } },
      localization: { priceFormatter: (p: number) => `${p.toFixed(0)}%` },
      // let the page scroll when the cursor is over the chart instead of the
      // chart hijacking the wheel to pan/zoom its time axis
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    })
    chartRef.current = chart

    const maardSeries = chart.addLineSeries({
      color: SERIES.maard,
      lineWidth: 2,
      title: 'Maard',
      lineStyle: LineStyle.Solid,
      lastValueVisible: true,
      priceLineVisible: false,
    })
    const bearsSeries = chart.addLineSeries({
      color: SERIES.bears,
      lineWidth: 2,
      title: 'Bears',
      lineStyle: LineStyle.Solid,
      lastValueVisible: true,
      priceLineVisible: false,
    })

    maardSeries.setData(maard.map((d) => ({ time: d.time as Time, value: d.value })) as LineData[])
    bearsSeries.setData(bears.map((d) => ({ time: d.time as Time, value: d.value })) as LineData[])

    // lock the percentage axis to 0–100 so both lines share one fixed scale
    maardSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) })

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [maard, bears, theme])

  return <div ref={containerRef} className="w-full h-[360px]" />
}
