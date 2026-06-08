import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '../api/client'
import { lsGet, lsSet } from '../lib/storage'
import type { SessionInfo, UploadResponse } from '../types'

const LS_SESSION_ID = 'th:sessionId'
const LS_SUFFIX = 'th:suffix'

export function useSession() {
  const [session, setSession] = useState<UploadResponse | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [suffix, setSuffix] = useState(() => lsGet(LS_SUFFIX) ?? '.SR')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep a ref so upload() always sees latest suffix without being in deps
  const suffixRef = useRef(suffix)
  useEffect(() => { suffixRef.current = suffix }, [suffix])

  // Read the stored wallet id ONCE at init, before any effect runs. The persist
  // effect below fires on mount with session=null and would otherwise overwrite
  // this pointer with null before the restore effect could read it.
  const restoreIdRef = useRef<string | null>(lsGet(LS_SESSION_ID))
  // Guards the persist effect from clobbering the stored id during the initial
  // restore (mount → session still null). Cleared once restore settles.
  const restoringRef = useRef<boolean>(restoreIdRef.current != null)

  // Persist suffix so a page refresh keeps the chosen exchange suffix.
  useEffect(() => { lsSet(LS_SUFFIX, suffix) }, [suffix])

  // Persist the selected wallet's session_id so a refresh can restore it.
  // Skipped while a restore is in flight so the mount null-write can't wipe it.
  useEffect(() => {
    if (restoringRef.current && session == null) return
    lsSet(LS_SESSION_ID, session?.session_id ?? null)
  }, [session])

  // On mount, restore the previously-selected wallet from localStorage.
  // Retries alongside the backend-boot race the sessions fetch already handles.
  useEffect(() => {
    const storedId = restoreIdRef.current
    if (!storedId) {
      restoringRef.current = false
      return
    }
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const attempt = async (tries: number) => {
      if (cancelled) return
      try {
        const resp = await api.loadSession(storedId)
        if (!cancelled) setSession(resp)
        restoringRef.current = false // restore done — resume normal persistence
      } catch {
        if (cancelled || tries <= 0) {
          restoringRef.current = false
          // session gone from DB (deleted) — drop the stale pointer
          if (tries <= 0) lsSet(LS_SESSION_ID, null)
          return
        }
        timers.push(setTimeout(() => attempt(tries - 1), 1000))
      }
    }
    attempt(5)
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchSessions = useCallback(async () => {
    try {
      const list = await api.getSessions()
      setSessions(list)
      return true
    } catch {
      return false
    }
  }, [])

  // Fetch the saved CSV library on mount. On a fresh app start the backend may
  // still be booting when the page loads, so the first request can fail; retry
  // a few times with backoff rather than silently leaving the list empty until
  // the next upload triggers a refetch.
  useEffect(() => {
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const attempt = async (tries: number) => {
      if (cancelled) return
      const ok = await fetchSessions()
      if (ok || cancelled || tries <= 0) return
      timers.push(setTimeout(() => attempt(tries - 1), 1000))
    }
    attempt(5)
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [fetchSessions])

  const upload = useCallback(async (files: File | File[]) => {
    const list = Array.isArray(files) ? files : [files]
    setUploading(true)
    setError(null)
    let last: UploadResponse | null = null
    const errors: string[] = []
    try {
      for (const file of list) {
        try {
          last = await api.uploadFile(file, suffixRef.current)
        } catch (e: unknown) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : 'Upload failed'}`)
        }
      }
      if (last) {
        setSession(last)
      } else {
        setSession(null)
      }
      if (errors.length) setError(errors.join('\n'))
      await fetchSessions()
      return last
    } finally {
      setUploading(false)
    }
  }, [fetchSessions])

  const selectSession = useCallback(async (sessionId: string) => {
    setError(null)
    try {
      const resp = await api.loadSession(sessionId)
      setSession(resp)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load session'
      setError(msg)
    }
  }, [])

  const deleteStoredSession = useCallback(async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId)
      setSession((prev) => (prev?.session_id === sessionId ? null : prev))
      await fetchSessions()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Delete failed'
      setError(msg)
    }
  }, [fetchSessions])

  const clear = useCallback(() => {
    setSession(null)
    setError(null)
  }, [])

  return {
    session,
    sessions,
    suffix,
    setSuffix,
    uploading,
    error,
    upload,
    clear,
    selectSession,
    deleteStoredSession,
    fetchSessions,
  }
}
