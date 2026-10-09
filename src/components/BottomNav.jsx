import { Briefcase, History, Home, Settings, TrendingUp } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const BASE_TABS = [
  { id: '/', label: 'Home', icon: Home },
  { id: '/market', label: 'Trade', icon: TrendingUp },
  { id: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { id: '/recuerdos', label: 'Recuerdos', icon: History },
]
const ADMIN_TAB = { id: '/admin', label: 'Admin', icon: Settings }

export default function BottomNav({ isHidden = false }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const tabs = profile?.is_admin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS

  return (
    <nav
      className={`fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 safe-bottom transition-transform duration-300 ${
        isHidden ? 'translate-y-full' : 'translate-y-0'
      }`}
      aria-label="Navegación principal"
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-around items-center h-16">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = location.pathname === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => navigate(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center flex-1 h-full transition-all ${
                  isActive ? 'text-polyblue' : 'text-gray-500'
                }`}
              >
                <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                <span className={`text-xs mt-1 ${isActive ? 'font-semibold' : 'font-normal'}`}>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
