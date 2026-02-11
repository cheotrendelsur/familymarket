import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'
import MarketPage from './pages/MarketPage'
import PortfolioPage from './pages/PortfolioPage'
import AdminPage from './pages/AdminPage'
import Navbar from './components/Navbar'
import BottomNav from './components/BottomNav'
import UsernameSetup from './components/UsernameSetup'

// Layout para rutas protegidas
function AppLayout() {
  const { user, loading, needsUsername, refreshProfile } = useAuth()

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
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}

// Componente principal
function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}

export default App