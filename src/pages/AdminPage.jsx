import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import ActivityTab from './admin/ActivityTab'
import CreateTab from './admin/CreateTab'
import DangerTab from './admin/DangerTab'
import MarketsTab from './admin/MarketsTab'
import PlayersTab from './admin/PlayersTab'
import SuggestionsList from './admin/SuggestionsList'
import TodayTab from './admin/TodayTab'
import { Disclosure } from './admin/adminUi'

function MoreTab({ isOwner }) {
  return (
    <div className="space-y-3">
      <Disclosure title="Registro de actividad" hint="Quién creó, resolvió o cambió qué">
        <ActivityTab />
      </Disclosure>
      <Disclosure title="Sugerencias ya revisadas" hint="Las que aprobaste o rechazaste">
        <SuggestionsList view="history" />
      </Disclosure>
      {isOwner && (
        <Disclosure title="Empezar una partida nueva" hint="Archiva esta partida y deja todo en cero" danger>
          <DangerTab />
        </Disclosure>
      )}
    </div>
  )
}

export default function AdminPage() {
  const { isStaff, isOwner } = useAuth()
  const { pendingSuggestions, activeItems } = useGame()
  const location = useLocation()
  const [tab, setTab] = useState(location.state?.tab || 'today')

  const todo = (pendingSuggestions || 0) + activeItems.filter((i) => i.state === 'pending').length

  const tabs = useMemo(() => {
    const list = [
      ['today', 'Hoy'],
      ['create', 'Crear'],
      ['markets', 'Mercados'],
    ]
    if (isOwner) list.push(['people', 'Gente'])
    list.push(['more', 'Más'])
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
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">{isOwner ? 'Panel del dueño' : 'Panel de moderador'}</h1>
        <p className="text-sm text-gray-500">{isOwner ? 'Todo lo que puedes hacer, en un solo lugar' : 'Crea y resuelve mercados, y revisa sugerencias'}</p>
      </div>

      <div className="sticky z-20 -mx-4 px-4 py-2 bg-polygray-bg" style={{ top: 'calc(56px + env(safe-area-inset-top))' }}>
        <div className="grid gap-1.5 bg-gray-200/70 rounded-2xl p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`relative h-10 rounded-xl text-sm font-bold transition-all ${tab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              {label}
              {id === 'today' && todo > 0 && (
                <span className="absolute -top-1 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {todo}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div key={tab} className="animate-fade-in">
        {tab === 'today' && <TodayTab onGo={setTab} />}
        {tab === 'create' && <CreateTab onDone={() => setTab('today')} />}
        {tab === 'markets' && <MarketsTab />}
        {tab === 'people' && isOwner && <PlayersTab />}
        {tab === 'more' && <MoreTab isOwner={isOwner} />}
      </div>
    </div>
  )
}
