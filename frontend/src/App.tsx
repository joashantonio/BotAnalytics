import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import UploadPage from './pages/UploadPage'
import TradesPage from './pages/TradesPage'
import ChartPage from './pages/ChartPage'
import AnalyticsPage from './pages/AnalyticsPage'
import { useSession } from './hooks/useSession'
import { useAnalytics } from './hooks/useAnalytics'
import { usePrefetch } from './hooks/usePrefetch'

export default function App() {
  const { session, sessions, suffix, setSuffix, uploading, error, upload, clear, selectSession, deleteStoredSession } = useSession()
  const { analytics, loading: analyticsLoading, error: analyticsError, fetch: fetchAnalytics, clear: clearAnalytics } = useAnalytics()
  const prefetchStatus = usePrefetch(session?.session_id ?? null)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)

  // Clear the selected trade when the session changes so a new CSV doesn't
  // inherit the previous file's symbol/trade (would 404 or chart wrong data).
  useEffect(() => {
    setSelectedSymbol(null)
    setSelectedTradeId(null)
  }, [session?.session_id])

  const handleDeleteSession = async (sessionId: string) => {
    if (session?.session_id === sessionId) clearAnalytics()
    await deleteStoredSession(sessionId)
  }

  const handleSelectTrade = (symbol: string, tradeId: string) => {
    setSelectedSymbol(symbol)
    setSelectedTradeId(tradeId)
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar />
      <main className="flex-1 overflow-hidden">
        <Routes>
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
                onClear={clear}
                onSelectSession={selectSession}
                onDeleteSession={handleDeleteSession}
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
