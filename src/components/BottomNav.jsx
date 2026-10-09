import { Briefcase, History, Home, Lightbulb, Settings, Trophy } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'

const BASE_TABS = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/ranking', label: 'Ranking', icon: Trophy },
  { to: '/portfolio', label: 'Portafolio', icon: Briefcase },
  { to: '/sugerir', label: 'Sugerir', icon: Lightbulb },
  { to: '/recuerdos', label: 'Recuerdos', icon: History },
]
const ADMIN_TAB = { to: '/admin', label: 'Admin', icon: Settings }

export default function BottomNav() {
  const { isStaff } = useAuth()
  const { pendingSuggestions, activeItems } = useGame()
  const { pathname } = useLocation()
  const tabs = isStaff ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-gray-200 z-40 safe-bottom"
      aria-label="Navegación principal"
    >
      <div className="max-w-5xl mx-auto flex items-stretch h-[60px]">
        {tabs.map((tab) => {
          const Icon = tab.icon
          // Las pantallas de detalle de un mercado cuelgan de "Inicio".
          const isActive =
            tab.to === '/' ? pathname === '/' || pathname.startsWith('/m/') || pathname.startsWith('/g/') : pathname.startsWith(tab.to)
          // Lo que espera al staff: sugerencias por revisar + mercados que ya cerraron y falta resolver.
          const badge = tab.to === '/admin' ? (pendingSuggestions || 0) + activeItems.filter((i) => i.state === 'pending').length : 0
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              aria-current={isActive ? 'page' : undefined}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isActive ? 'text-polyblue' : 'text-gray-400'
              }`}
            >
              <span
                className={`absolute top-0 h-0.5 rounded-full bg-polyblue transition-all duration-300 ${
                  isActive ? 'w-8 opacity-100' : 'w-0 opacity-0'
                }`}
              />
              <span className="relative">
                <Icon size={22} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'scale-110 transition-transform' : 'transition-transform'} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center animate-pop">
                    {badge}
                  </span>
                )}
              </span>
              <span className={`text-[10px] leading-none truncate max-w-full px-0.5 ${isActive ? 'font-bold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
