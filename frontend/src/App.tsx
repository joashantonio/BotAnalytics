import { useState, useEffect, useRef } from 'react'
import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import UploadPage from './pages/UploadPage'
import DashboardPage from './pages/DashboardPage'
import TradesPage from './pages/TradesPage'
import ChartPage from './pages/ChartPage'
import AnalyticsPage from './pages/AnalyticsPage'
import type { SelectedExec } from './types'
import { lsGet, lsSet } from './lib/storage'
import { useSession } from './hooks/useSession'
import { useAnalytics } from './hooks/useAnalytics'
import { usePrefetch } from './hooks/usePrefetch'

export default function App() {
  const { session, sessions, suffix, setSuffix, uploading, error, upload, clear, selectSession, deleteStoredSession, fetchSessions } = useSession()
  const { analytics, loading: analyticsLoading, error: analyticsError, fetch: fetchAnalytics, clear: clearAnalytics } = useAnalytics()
  const prefetchStatus = usePrefetch(session?.session_id ?? null)
  // Restore the previously-charted trade from localStorage. It is tagged with
  // the session it belongs to so we only restore it when that same wallet loads.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(
    () => lsGet('th:symbol'),
  )
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(
    () => lsGet('th:tradeId'),
  )
  // Which execution within the selected trade to highlight on the chart. Set
  // when arriving from the Executions table; cleared on any plain trade pick
  // (Trades page / chart sidebar) since those carry no execution context.
  const [selectedExec, setSelectedExec] = useState<SelectedExec | null>(null)

  // Track the session a trade selection belongs to. Seeded from storage so the
  // mount restore (null → restored id) isn't treated as a wallet *switch*.
  const tradeSessionRef = useRef<string | null>(lsGet('th:tradeSessionId'))

  // Clear the selected trade when the wallet actually changes to a different
  // one, so a new CSV doesn't inherit the previous file's symbol/trade (would
  // 404 or chart wrong data). A refresh that reloads the SAME wallet keeps it.
  useEffect(() => {
    const id = session?.session_id ?? null
    if (id === tradeSessionRef.current) return // same wallet (incl. mount restore)
    tradeSessionRef.current = id
    setSelectedSymbol(null)
    setSelectedTradeId(null)
    setSelectedExec(null)
  }, [session?.session_id])

  // Persist the current trade selection (tagged with its wallet).
  useEffect(() => {
    lsSet('th:symbol', selectedSymbol)
    lsSet('th:tradeId', selectedTradeId)
    lsSet('th:tradeSessionId', selectedSymbol ? (session?.session_id ?? null) : null)
  }, [selectedSymbol, selectedTradeId, session?.session_id])

  const handleDeleteSession = async (sessionId: string) => {
    if (session?.session_id === sessionId) clearAnalytics()
    await deleteStoredSession(sessionId)
  }

  const handleSelectTrade = (symbol: string, tradeId: string, exec?: SelectedExec) => {
    setSelectedSymbol(symbol)
    setSelectedTradeId(tradeId)
    // exec passed only from the Executions table; any other pick clears it.
    setSelectedExec(exec ?? null)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar sessions={sessions} session={session} onSelectSession={selectSession} />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/dashboard" element={<DashboardPage suffix={suffix} />} />
          <Route
            path="/"
            element={
              <UploadPage
                uploading={uploading}
                error={error}
                session={session}
                sessions={sessions}
                suffix={suffix}
                onSuffixChange={setSuffix}
                onUpload={upload}
                onDeleteSession={handleDeleteSession}
                onRefresh={fetchSessions}
                prefetchStatus={prefetchStatus}
              />
            }
          />
          <Route
            path="/trades"
            element={
              <TradesPage
                session={session}
                suffix={suffix}
                onSelectTrade={handleSelectTrade}
              />
            }
          />
          <Route
            path="/chart"
            element={
              <ChartPage
                session={session}
                suffix={suffix}
                selectedSymbol={selectedSymbol}
                selectedTradeId={selectedTradeId}
                selectedExec={selectedExec}
                onSelectTrade={handleSelectTrade}
              />
            }
          />
          <Route
            path="/analytics"
            element={
              <AnalyticsPage
                session={session}
                suffix={suffix}
                analytics={analytics}
                loading={analyticsLoading}
                error={analyticsError}
                onEnter={fetchAnalytics}
              />
            }
          />
        </Routes>
      </main>
    </div>
  )
}
