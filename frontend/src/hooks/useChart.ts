import { useState, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { ChartData } from '../types'

export function useChart(sessionId: string, suffix: string) {
  const [data, setData] = useState<ChartData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Monotonic request id — only the latest in-flight load may write state.
  // Prevents a slow earlier fetch from clobbering a newer trade's chart.
  const reqIdRef = useRef(0)

  const load = useCallback(
    async (symbol: string, tradeId: string) => {
      const myReq = ++reqIdRef.current
      setLoading(true)
      setError(null)
      try {
        const chart = await api.getChart(sessionId, symbol, tradeId, suffix)
        if (myReq !== reqIdRef.current) return // superseded
        setData(chart)
      } catch (e: unknown) {
        if (myReq !== reqIdRef.current) return // superseded
        setError(e instanceof Error ? e.message : 'Failed to load chart')
        setData(null)
      } finally {
        if (myReq === reqIdRef.current) setLoading(false)
      }
    },
    [sessionId, suffix],
  )

  return { data, loading, error, load }
}
