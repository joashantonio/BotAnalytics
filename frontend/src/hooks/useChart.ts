import { useState, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { ChartData } from '../types'

export function useChart(
  sessionId: string,
  suffix: string,
  mode: 'psar' | 'ma10' | 'ma200' = 'psar',
  fromDate?: string,
  toDate?: string,
) {
  const [data, setData] = useState<ChartData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reqIdRef = useRef(0)

  const load = useCallback(
    async (symbol: string, tradeId: string) => {
      const myReq = ++reqIdRef.current
      setLoading(true)
      setError(null)
      try {
        const chart = await api.getChart(sessionId, symbol, tradeId, suffix, mode, fromDate, toDate)
        if (myReq !== reqIdRef.current) return
        setData(chart)
      } catch (e: unknown) {
        if (myReq !== reqIdRef.current) return
        setError(e instanceof Error ? e.message : 'Failed to load chart')
        setData(null)
      } finally {
        if (myReq === reqIdRef.current) setLoading(false)
      }
    },
    [sessionId, suffix, mode, fromDate, toDate],
  )

  return { data, loading, error, load }
}
