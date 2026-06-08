import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { SessionInfo, UploadResponse } from '../types'

export function useSession() {
  const [session, setSession] = useState<UploadResponse | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [suffix, setSuffix] = useState('.SR')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suffixRef = useRef(suffix)
  useEffect(() => { suffixRef.current = suffix }, [suffix])

  const fetchSessions = useCallback(async () => {
    try {
      const list = await api.getSessions()
      setSessions(list)
    } catch {

    }
  }, [])

  useEffect(() => {
    fetchSessions()
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
