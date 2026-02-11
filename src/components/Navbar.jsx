import { LogOut, DollarSign } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Navbar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    const { error } = await signOut()
    if (!error) {
      navigate('/auth')
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-polyblue rounded-lg flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-lg">FM</span>
            </div>
            <span className="font-bold text-xl text-gray-900 hidden sm:block">FamilyMarket</span>
            <span className="font-bold text-xl text-gray-900 sm:hidden">FM</span>
          </div>
          
          {/* Balance y Sign Out */}
          <div className="flex items-center gap-3">
            {/* Balance Badge */}
            <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
              <DollarSign size={16} className="text-polygreen" strokeWidth={2.5} />
              <span className="font-bold text-polygreen text-sm">
                {profile?.balance?.toFixed(2) || '0.00'}
              </span>
            </div>
            
            {/* Sign Out Button */}
            <button
              onClick={handleSignOut}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors active:bg-gray-200"
              aria-label="Cerrar sesión"
            >
              <LogOut size={20} className="text-gray-600" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}