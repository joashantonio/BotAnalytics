import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { PrefetchStatusResponse } from '../types'

const POLL_INTERVAL_MS = 1500

export function usePrefetch(sessionId: string | null) {
  const [status, setStatus] = useState<PrefetchStatusResponse | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    stopPolling()
    setStatus(null)
    if (!sessionId) return

    let cancelled = false
    const poll = async () => {
      try {
        const s = await api.getPrefetchStatus(sessionId)
        if (cancelled) return
        setStatus(s)
        if (s.done) stopPolling()
      } catch {

      }
    }

    poll()
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [sessionId])

  return status
}
