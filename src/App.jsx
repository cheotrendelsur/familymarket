import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { GameProvider } from './context/GameContext'
import { ConfirmProvider } from './components/ConfirmDialog'
import ErrorBoundary from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import Navbar from './components/Navbar'
import PageLoader from './components/PageLoader'
import StatusBanner from './components/StatusBanner'
import UsernameSetup from './components/UsernameSetup'

// AuthPage se carga de inmediato (es la primera pantalla); el resto bajo demanda.
import AuthPage from './pages/AuthPage'

const HomePage = lazy(() => import('./pages/HomePage'))
const MarketPage = lazy(() => import('./pages/MarketPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const RecuerdosPage = lazy(() => import('./pages/RecuerdosPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function ProfileProblem() {
  const { profileError, retryProfile, signOut } = useAuth()
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-polygray-bg">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-gray-200 shadow-lg p-8 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">No pudimos cargar tu perfil</h2>
        <p className="text-gray-600 text-sm mb-6">{profileError || 'Revisa tu conexión e inténtalo de nuevo.'}</p>
        <button onClick={retryProfile} className="w-full bg-polyblue text-white py-3 rounded-xl font-bold mb-3">
          Reintentar
        </button>
        <button onClick={() => signOut()} className="w-full text-gray-500 py-2 text-sm font-semibold">
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

function AppLayout() {
  const { user, profile, loading, profileError, needsUsername, refreshProfile } = useAuth()
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (loading) return <PageLoader label="Cargando FamilyMarket..." fullScreen />
  if (!user) return <Navigate to="/auth" replace />
  if (profileError || !profile) return <ProfileProblem />
  if (needsUsername) return <UsernameSetup onComplete={refreshProfile} />

  return (
    <GameProvider>
      <div className="min-h-screen bg-polygray-bg">
        <Navbar />
        <main className="pt-16 pb-20">
          <StatusBanner />
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<HomePage setIsModalOpen={setIsModalOpen} />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/recuerdos" element={<RecuerdosPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <BottomNav isHidden={isModalOpen} />
      </div>
    </GameProvider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfirmProvider>
          <Router>
            <Toaster
              position="top-center"
              containerStyle={{ top: 72 }}
              toastOptions={{
                duration: 5000,
                style: { borderRadius: '16px', padding: '14px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' },
              }}
            />
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/*" element={<AppLayout />} />
            </Routes>
          </Router>
        </ConfirmProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
