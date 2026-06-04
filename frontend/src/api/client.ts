import type {
  Analytics,
  ChartData,
  CorrectExecutions,
  PrefetchStatusResponse,
  SessionInfo,
  SymbolSummary,
  TradeRow,
  UploadResponse,
} from '../types'

const BASE = ''

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? res.statusText)
  }
  return res.json()
}

export const api = {
  uploadFile: (file: File, suffix = '.SR'): Promise<UploadResponse> => {
    const form = new FormData()
    form.append('file', file)
    return req(`/trades/upload?suffix=${encodeURIComponent(suffix.trim())}`, { method: 'POST', body: form })
  },

  getSessions: (): Promise<SessionInfo[]> => req('/trades/sessions'),

  loadSession: (sessionId: string): Promise<UploadResponse> =>
    req(`/trades/sessions/${sessionId}`),

  deleteSession: (sessionId: string): Promise<{ deleted: string }> =>
    req(`/trades/sessions/${sessionId}`, { method: 'DELETE' }),

  getTrades: (
    sessionId: string,
    params?: { status?: string; symbol?: string; from_date?: string; to_date?: string },
  ): Promise<TradeRow[]> => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.symbol) qs.set('symbol', params.symbol)
    if (params?.from_date) qs.set('from_date', params.from_date)
    if (params?.to_date) qs.set('to_date', params.to_date)
    const q = qs.toString()
    return req(`/trades/sessions/${sessionId}/trades${q ? `?${q}` : ''}`)
  },

  getSymbols: (sessionId: string): Promise<SymbolSummary[]> =>
    req(`/symbols/${sessionId}`),

  getChart: (
    sessionId: string,
    symbol: string,
    tradeId: string,
    suffix = '.SR',
  ): Promise<ChartData> => {
    const cleanSuffix = suffix.trim()
    return req(`/symbols/${sessionId}/${symbol}/chart?trade_id=${encodeURIComponent(tradeId)}&suffix=${encodeURIComponent(cleanSuffix)}`)
  },

  getSymbolAnalytics: (
    sessionId: string,
    symbol: string,
    suffix = '.SR',
  ): Promise<Analytics> =>
    req(`/symbols/${sessionId}/${symbol}/analytics?suffix=${encodeURIComponent(suffix.trim())}`),

  getSessionAnalytics: (sessionId: string, suffix = '.SR'): Promise<Analytics> =>
    req(`/symbols/${sessionId}/analytics/summary?suffix=${encodeURIComponent(suffix.trim())}`),

  getCorrectExecutions: (
    sessionId: string,
    suffix = '.SR',
    fromDate?: string,
    toDate?: string,
  ): Promise<CorrectExecutions> => {
    const qs = new URLSearchParams({ suffix: suffix.trim() })
    if (fromDate) qs.set('from_date', fromDate)
    if (toDate) qs.set('to_date', toDate)
    return req(`/symbols/${sessionId}/analytics/correct-executions?${qs.toString()}`)
  },

  getPrefetchStatus: (sessionId: string): Promise<PrefetchStatusResponse> =>
    req(`/trades/sessions/${sessionId}/prefetch-status`),
}
