import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import { GameProvider } from './context/GameContext'
import { ConfirmProvider } from './components/ConfirmDialog'
import ErrorBoundary from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import CelebrationHost from './components/CelebrationHost'
import { PasswordBanner } from './components/ChangePasswordSheet'
import Navbar from './components/Navbar'
import PageLoader from './components/PageLoader'
import PushPrompt from './components/PushPrompt'
import StatusBanner from './components/StatusBanner'
import { TradeProvider } from './components/TradeSheet'
import UpdatePrompt from './components/UpdatePrompt'
import Tour from './components/tour/Tour'
import UsernameSetup from './components/UsernameSetup'

// AuthPage se carga de inmediato (es la primera pantalla); el resto bajo demanda.
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'

const MarketPage = lazy(() => import('./pages/MarketPage'))
const GroupPage = lazy(() => import('./pages/GroupPage'))
const RankingPage = lazy(() => import('./pages/RankingPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const SuggestPage = lazy(() => import('./pages/SuggestPage'))
const RecuerdosPage = lazy(() => import('./pages/RecuerdosPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

// Al ir a una pantalla nueva se vuelve arriba; al volver con "atrás" se respeta la posición.
function ScrollToTop() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0)
  }, [pathname, navType])
  return null
}

// Al tocar una notificación con la app abierta, el service worker avisa y se navega sin recargar.
function PushNavigation() {
  const navigate = useNavigate()
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined
    const onMessage = (event) => {
      if (event.data?.type === 'fm-navigate' && typeof event.data.url === 'string' && event.data.url.startsWith('/')) navigate(event.data.url)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
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
  const location = useLocation()
  const { user, profile, loading, profileError, needsUsername, needsTour, completeTour, tourReplay, stopTourReplay, refreshProfile } = useAuth()

  if (loading) return <PageLoader label="Cargando FamilyMarket..." fullScreen />
  // Se conserva ?error=... por si venimos de un inicio de sesión con Google que falló.
  if (!user) return <Navigate to={{ pathname: '/auth', search: location.search, hash: location.hash }} replace />
  if (profileError || !profile) return <ProfileProblem />
  if (needsUsername) return <UsernameSetup onComplete={refreshProfile} />
  // Primera vez: el tutorial reemplaza a la app (no toca datos reales) hasta completarlo o saltarlo.
  if (needsTour) return <Tour mode="first" onFinish={completeTour} onSkip={completeTour} />

  return (
    <GameProvider>
      <TradeProvider>
        <div className="min-h-screen bg-polygray-bg">
          <Navbar />
          <main className="app-main">
            <StatusBanner />
            <PasswordBanner />
            <ScrollToTop />
            <PushNavigation />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/m/:id" element={<MarketPage />} />
                <Route path="/g/:groupId" element={<GroupPage />} />
                <Route path="/ranking" element={<RankingPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/sugerir" element={<SuggestPage />} />
                <Route path="/recuerdos" element={<RecuerdosPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/market" element={<Navigate to="/" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
          <BottomNav />
          <CelebrationHost />
          <PushPrompt />
          {tourReplay && <Tour mode="replay" onFinish={stopTourReplay} onSkip={stopTourReplay} />}
          <UpdatePrompt />
        </div>
      </TradeProvider>
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
              containerStyle={{ top: 68 }}
              toastOptions={{
                duration: 5000,
                style: { borderRadius: '16px', padding: '12px 14px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: 14 },
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
