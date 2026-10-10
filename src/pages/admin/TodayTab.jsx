import { CheckCircle2, Clock, Lightbulb, Lock, Plus, XCircle } from 'lucide-react'
import { useGame } from '../../context/GameContext'
import { timeAgo } from '../../lib/time'
import { sideLabel } from '../../lib/format'
import { Countdown } from '../../components/Countdown'
import MarketImage from '../../components/MarketImage'
import { Skeleton } from '../../components/ui/Skeleton'
import SuggestionsList from './SuggestionsList'
import { useManage } from '../../hooks/useManage'
import { useMarketActions } from './useMarketActions'

const DAY = 24 * 3600e3

function Tile({ value, label, tone, onClick }) {
  return (
    <button onClick={onClick} className={`rounded-2xl p-3 text-left border tap-feedback ${tone}`}>
      <div className="text-2xl font-black tabular-nums leading-none">{value}</div>
      <div className="text-[11px] font-bold mt-1 leading-tight">{label}</div>
    </button>
  )
}

function SectionTitle({ icon: Icon, children, count, tone = 'text-gray-500' }) {
  return (
    <h2 className={`flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider ${tone}`}>
      <Icon size={16} /> {children}
      {count > 0 && <span className="text-xs font-bold bg-gray-200 text-gray-700 rounded-full px-2 py-0.5">{count}</span>}
    </h2>
  )
}

/** Pantalla de inicio del panel: solo lo que hay que hacer ahora. */
export default function TodayTab({ onGo }) {
  const { items: allItems, marketsLoaded, pendingSuggestions, now } = useGame()
  const { canManageItem, isOwner } = useManage()
  const actions = useMarketActions()
  // El moderador solo ve (y maneja) lo que él creó.
  const items = allItems.filter(canManageItem)

  const pending = items.filter((i) => i.state === 'pending')
  const closingSoon = items
    .filter((i) => i.state === 'open' && i.closes_at && Date.parse(i.closes_at) - now < DAY)
    .sort((a, b) => Date.parse(a.closes_at) - Date.parse(b.closes_at))
  const openCount = items.filter((i) => i.state === 'open').length
  const suggestions = pendingSuggestions || 0
  const allClear = marketsLoaded && pending.length === 0 && suggestions === 0

  if (!marketsLoaded) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2.5">
        <Tile value={pending.length} label="Por resolver" tone={pending.length ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-gray-200 text-gray-500'} onClick={() => onGo('markets')} />
        <Tile value={suggestions} label="Sugerencias" tone={suggestions ? 'bg-blue-50 border-blue-200 text-polyblue' : 'bg-white border-gray-200 text-gray-500'} />
        <Tile value={openCount} label="Abiertos" tone="bg-white border-gray-200 text-gray-700" onClick={() => onGo('markets')} />
      </div>

      {!isOwner && (
        <p className="text-xs text-gray-500 -mt-3">Como moderador, aquí ves y manejas solo los mercados que tú creaste.</p>
      )}

      {allClear && (
        <div className="text-center bg-white rounded-3xl border border-gray-200 shadow-card py-9 px-5 animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 size={34} className="text-polygreen" />
          </div>
          <h2 className="text-lg font-extrabold text-gray-900">Todo al día</h2>
          <p className="text-sm text-gray-500 mt-1">No hay nada por resolver ni por aprobar.</p>
        </div>
      )}

      {pending.length > 0 && (
        <section className="space-y-3">
          <SectionTitle icon={Lock} count={pending.length} tone="text-amber-700">
            Por resolver
          </SectionTitle>
          {pending.map((item) =>
            item.kind === 'single' ? (
              <div key={item.key} className="bg-white rounded-2xl border-2 border-amber-200 p-4 shadow-card">
                <div className="flex gap-3 items-start">
                  <MarketImage item={item} size={44} />
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 leading-snug">{item.market.question}</h3>
                    <p className="text-xs font-semibold text-amber-700 mt-0.5">Las apuestas cerraron {timeAgo(item.market.closes_at)}</p>
                  </div>
                </div>
                <p className="text-xs font-semibold text-gray-500 mt-3 mb-2">¿Qué pasó?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => actions.resolve(item.market, 'YES')} className="flex items-center justify-center gap-1.5 bg-polygreen text-white py-3.5 rounded-xl font-bold shadow-md shadow-green-500/20 tap-feedback">
                    <CheckCircle2 size={19} strokeWidth={2.6} /> Gana {sideLabel('YES')}
                  </button>
                  <button onClick={() => actions.resolve(item.market, 'NO')} className="flex items-center justify-center gap-1.5 bg-polyred text-white py-3.5 rounded-xl font-bold shadow-md shadow-red-500/20 tap-feedback">
                    <XCircle size={19} strokeWidth={2.6} /> Gana {sideLabel('NO')}
                  </button>
                </div>
              </div>
            ) : (
              <div key={item.key} className="bg-white rounded-2xl border-2 border-amber-200 p-4 shadow-card">
                <div className="flex gap-3 items-start">
                  <MarketImage item={item} size={44} />
                  <div className="min-w-0">
                    <h3 className="font-bold text-gray-900 leading-snug">{item.title}</h3>
                    <p className="text-xs font-semibold text-amber-700 mt-0.5">Las apuestas cerraron · ¿quién ganó?</p>
                  </div>
                </div>
                <div className="mt-3 divide-y divide-gray-100">
                  {item.markets
                    .filter((m) => m.state !== 'resolved')
                    .map((m) => (
                      <div key={m.id} className="flex items-center gap-3 py-2">
                        <span className="flex-1 font-semibold text-gray-800 truncate">{m.question}</span>
                        <button
                          onClick={() => actions.resolveGroup(item.markets, m)}
                          className="px-4 py-2.5 rounded-xl bg-polygreen text-white text-sm font-bold shadow-sm tap-feedback"
                        >
                          Gana este
                        </button>
                      </div>
                    ))}
                </div>
                <button onClick={() => actions.resolveGroup(item.markets, null)} className="mt-2 w-full py-2.5 text-sm font-bold text-gray-500 rounded-xl bg-gray-50">
                  Ninguna gana
                </button>
              </div>
            )
          )}
        </section>
      )}

      {suggestions > 0 && (
        <section className="space-y-3">
          <SectionTitle icon={Lightbulb} count={suggestions} tone="text-polyblue">
            Sugerencias nuevas
          </SectionTitle>
          <SuggestionsList view="pending" />
        </section>
      )}

      {closingSoon.length > 0 && (
        <section className="space-y-3">
          <SectionTitle icon={Clock}>Cierran en las próximas 24 h</SectionTitle>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100">
            {closingSoon.map((item) => (
              <div key={item.key} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 leading-snug truncate">{item.title}</p>
                  <Countdown closesAt={item.closes_at} className="mt-1" />
                </div>
                <button
                  onClick={() => actions.closeNow(item.markets[0], item.kind === 'group')}
                  className="px-3.5 py-2 rounded-xl bg-amber-50 text-amber-800 text-sm font-bold border border-amber-100 tap-feedback"
                >
                  Cerrar ya
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <button
        onClick={() => onGo('create')}
        className="w-full flex items-center justify-center gap-2 bg-polyblue text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-blue-500/25 tap-feedback"
      >
        <Plus size={22} strokeWidth={2.8} /> Crear un mercado
      </button>

      {actions.editor}
    </div>
  )
}

