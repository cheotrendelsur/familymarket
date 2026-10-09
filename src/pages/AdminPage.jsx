import { useMemo, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import ActivityTab from './admin/ActivityTab'
import CreateTab from './admin/CreateTab'
import DangerTab from './admin/DangerTab'
import MarketsTab from './admin/MarketsTab'
import PlayersTab from './admin/PlayersTab'
import SuggestionsTab from './admin/SuggestionsTab'

export default function AdminPage() {
  const { isStaff, isOwner } = useAuth()
  const { config, pendingSuggestions } = useGame()
  const [tab, setTab] = useState('create')

  const tabs = useMemo(() => {
    const list = [
      ['create', 'Crear'],
      ['markets', 'Mercados'],
      ['suggestions', 'Sugerencias'],
    ]
    if (isOwner) list.push(['players', 'Jugadores'])
    list.push(['activity', 'Actividad'])
    if (isOwner) list.push(['danger', 'Nueva partida'])
    return list
  }, [isOwner])

  if (!isStaff) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe px-4">
        <div className="text-center bg-white rounded-3xl p-8 border border-red-200 shadow-lg">
          <AlertCircle size={60} className="mx-auto text-red-500 mb-4" />
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Acceso denegado</h2>
          <p className="text-gray-600">Esta zona es para el dueño y los moderadores.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-4">
      <div className="bg-gradient-to-r from-polyblue to-blue-600 rounded-3xl p-5 text-white shadow-xl shadow-blue-500/20">
        <h1 className="text-2xl font-extrabold">{isOwner ? 'Panel del dueño' : 'Panel de moderador'}</h1>
        <p className="text-blue-100 text-sm mt-0.5">
          Liquidez {config.initial_liquidity} · Comisión {(config.fee_rate * 100).toFixed(0)}% · {config.daily_limit} movimientos al día
        </p>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide sticky z-20 bg-polygray-bg/95 backdrop-blur py-2" style={{ top: 'calc(56px + env(safe-area-inset-top))' }}>
        <div className="flex gap-2 w-max pr-4">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`relative flex-shrink-0 h-10 px-4 rounded-full text-sm font-bold border transition-colors ${
                tab === id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
              }`}
            >
              {label}
              {id === 'suggestions' && pendingSuggestions > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
                  {pendingSuggestions}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div key={tab} className="animate-fade-in">
        {tab === 'create' && <CreateTab />}
        {tab === 'markets' && <MarketsTab />}
        {tab === 'suggestions' && <SuggestionsTab />}
        {tab === 'players' && isOwner && <PlayersTab />}
        {tab === 'activity' && <ActivityTab />}
        {tab === 'danger' && isOwner && <DangerTab />}
      </div>
    </div>
  )
}
