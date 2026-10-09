import { DollarSign, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { money } from '../lib/format'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    const { error } = await signOut()
    if (!error) navigate('/auth')
  }

  return (
    <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 bg-polyblue rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-white font-bold text-lg">FM</span>
            </div>
            <div className="min-w-0 leading-tight">
              <span className="font-bold text-lg text-gray-900 hidden sm:block">FamilyMarket</span>
              {profile?.username && (
                <span className="text-xs text-gray-500 block truncate max-w-[120px] sm:max-w-none">@{profile.username}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200" aria-label="Saldo disponible">
              <DollarSign size={16} className="text-polygreen" strokeWidth={2.5} />
              <span className="font-bold text-polygreen text-sm">{money(profile?.balance, 2).replace('$', '')}</span>
            </div>
            <button onClick={handleSignOut} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" aria-label="Cerrar sesión">
              <LogOut size={20} className="text-gray-600" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
