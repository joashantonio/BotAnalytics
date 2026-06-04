import { useState, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { Analytics, UploadResponse } from '../types'

export function useAnalytics() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lastKey = useRef<string | null>(null)
  const hasData = useRef(false)

  const fetch = useCallback(async (session: UploadResponse | null, suffix: string) => {
    if (!session) {
      setAnalytics(null)
      lastKey.current = null
      hasData.current = false
      return
    }
    const key = `${session.session_id}::${suffix.trim()}`
    if (key === lastKey.current && hasData.current) return

    setLoading(true)
    setError(null)
    try {
      const data = await api.getSessionAnalytics(session.session_id, suffix)
      setAnalytics(data)
      lastKey.current = key
      hasData.current = true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, []) // stable ref — stale-check done via refs

  const clear = useCallback(() => {
    setAnalytics(null)
    lastKey.current = null
    hasData.current = false
    setError(null)
  }, [])

  return { analytics, loading, error, fetch, clear }
}
