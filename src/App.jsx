import { useState, lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import BottomNav from './components/BottomNav'
import UsernameSetup from './components/UsernameSetup'

// ============================================
// LAZY LOADING DE PÁGINAS (OPTIMIZACIÓN)
// ============================================

// AuthPage se carga inmediatamente (es la primera página)
import AuthPage from './pages/AuthPage'

// Las demás páginas se cargan bajo demanda (lazy)
const HomePage = lazy(() => import('./pages/HomePage'))
const MarketPage = lazy(() => import('./pages/MarketPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

// ============================================
// COMPONENTE DE LOADING (MIENTRAS CARGA LAZY)
// ============================================

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-polygray-bg">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-3 border-polyblue mx-auto mb-3"></div>
        <p className="text-gray-600 text-sm font-medium">Cargando...</p>
      </div>
    </div>
  )
}

// ============================================
// LAYOUT PARA RUTAS PROTEGIDAS
// ============================================

function AppLayout() {
  const { user, loading, needsUsername, refreshProfile } = useAuth()
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-polygray-bg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-polyblue mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium text-lg">Cargando FamilyMarket...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  // Mostrar modal de username si es necesario
  if (needsUsername) {
    return <UsernameSetup onComplete={refreshProfile} />
  }

  return (
    <div className="min-h-screen bg-polygray-bg">
      <Navbar />
      <main className="pt-16 pb-20">
        {/* Suspense envuelve las rutas lazy para mostrar loader */}
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<HomePage setIsModalOpen={setIsModalOpen} />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </Suspense>
      </main>
      <BottomNav isHidden={isModalOpen} />
    </div>
  )
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

function App() {
  return (
    <AuthProvider>
      <Router>
        {/* NUEVO: CONTENEDOR DE NOTIFICACIONES */}
        <Toaster 
          position="top-center"
          toastOptions={{
            duration: 5000,
            style: {
              borderRadius: '16px',
              padding: '16px',
              boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            },
          }}
        />
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App