import { Home, TrendingUp, Briefcase, Settings } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useLocation } from 'react-router-dom'

export default function BottomNav() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const tabs = [
    { id: '/', label: 'Home', icon: Home },
    { id: '/market', label: 'Trade', icon: TrendingUp },
    { id: '/portfolio', label: 'Portfolio', icon: Briefcase },
  ]

  // Agregar tab de Admin solo si el usuario es admin
  if (profile?.is_admin) {
    tabs.push({ id: '/admin', label: 'Admin', icon: Settings })
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-bottom">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-around items-center h-16">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = location.pathname === tab.id
            
            return (
              <button
                key={tab.id}
                onClick={() => navigate(tab.id)}
                className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
                  isActive ? 'text-polyblue' : 'text-gray-500'
                }`}
              >
                <Icon 
                  size={24} 
                  strokeWidth={isActive ? 2.5 : 2} 
                  className="transition-all"
                />
                <span className={`text-xs mt-1 transition-all ${
                  isActive ? 'font-semibold' : 'font-normal'
                }`}>
                  {tab.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}