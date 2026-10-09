import { LogOut, Zap } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { money } from '../lib/format'
import AnimatedNumber from './ui/AnimatedNumber'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const { daily } = useGame()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    const { error } = await signOut()
    if (!error) navigate('/auth')
  }

  const low = daily && daily.remaining <= 5

  return (
    <header className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur border-b border-gray-200 z-40 app-top">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 min-w-0" aria-label="Ir al inicio">
          <div className="w-9 h-9 bg-polyblue rounded-xl flex items-center justify-center shadow-sm flex-shrink-0">
            <span className="text-white font-extrabold text-sm tracking-tight">FM</span>
          </div>
          <div className="min-w-0 leading-tight">
            <span className="font-extrabold text-gray-900 hidden sm:block">FamilyMarket</span>
            {profile?.username && (
              <span className="text-xs text-gray-500 block truncate max-w-[88px] sm:max-w-none">@{profile.username}</span>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {daily && (
            <Link
              to="/portfolio"
              className={`flex items-center gap-1 h-8 px-2.5 rounded-full text-xs font-bold border ${
                low ? 'bg-red-50 text-red-600 border-red-200' : 'bg-gray-50 text-gray-600 border-gray-200'
              }`}
              aria-label={`${daily.remaining} movimientos restantes hoy`}
            >
              <Zap size={13} /> <span className="tabular-nums">{daily.remaining}</span>
            </Link>
          )}
          <Link
            to="/portfolio"
            className="flex items-center h-8 px-3 rounded-full bg-emerald-50 border border-emerald-200 text-polygreen font-extrabold text-sm tabular-nums"
            aria-label="Saldo disponible"
          >
            <AnimatedNumber value={profile?.balance ?? 0} flash duration={900} format={(v) => money(v)} />
          </Link>
          <button onClick={handleSignOut} className="p-2 -mr-1 hover:bg-gray-100 rounded-full" aria-label="Cerrar sesión">
            <LogOut size={19} className="text-gray-500" strokeWidth={2} />
          </button>
        </div>
      </div>
    </header>
  )
}
