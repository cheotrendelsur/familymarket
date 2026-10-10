import { useMemo, useState } from 'react'
import { CheckCircle, Lock, MoreHorizontal, Pencil, RotateCcw, Trash2, Trophy, XCircle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { StateBadge } from '../../components/Countdown'
import MarketImage from '../../components/MarketImage'
import Sheet from '../../components/ui/Sheet'
import { noPrice, yesPrice } from '../../lib/trading'
import { sideLabel } from '../../lib/format'
import { useManage } from '../../hooks/useManage'
import { useMarketActions } from './useMarketActions'

const FILTERS = [
  ['open', 'Abiertos'],
  ['pending', 'Por resolver'],
  ['resolved', 'Resueltos'],
]

function ActionRow({ icon: Icon, label, hint, tone = 'text-gray-800', onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-1 py-3.5 text-left tap-feedback">
      <span className={`w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center ${tone}`}>
        <Icon size={19} />
      </span>
      <span className="min-w-0">
        <span className={`block font-bold ${tone}`}>{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </button>
  )
}

function MarketCard({ market, onMore, onResolve }) {
  const pseudo = { kind: 'single', state: market.state, market, closes_at: market.state === 'open' ? market.closes_at : null }
  return (
    <div className={`border rounded-2xl p-4 ${market.state === 'resolved' ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200 shadow-card'}`}>
      <div className="flex items-start gap-3">
        <MarketImage item={market} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 leading-snug">{market.question}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StateBadge item={pseudo} />
            <span className="text-xs font-semibold text-gray-400 tabular-nums">
              Sí {(yesPrice(market) * 100).toFixed(0)}¢ · No {(noPrice(market) * 100).toFixed(0)}¢
            </span>
            {market.target_users?.length > 0 && <span className="text-xs text-gray-500">👻 oculto para {market.target_users.length}</span>}
          </div>
        </div>
        <button onClick={() => onMore(market)} aria-label="Más acciones" className="p-2 -mr-1 -mt-1 rounded-full text-gray-500 hover:bg-gray-100">
          <MoreHorizontal size={22} />
        </button>
      </div>

      {market.state !== 'resolved' ? (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => onResolve(market, 'YES')} className="flex items-center justify-center gap-1.5 bg-polygreen text-white py-3.5 rounded-xl font-bold shadow-md shadow-green-500/20 tap-feedback">
            <CheckCircle size={19} strokeWidth={2.5} /> Gana {sideLabel('YES')}
          </button>
          <button onClick={() => onResolve(market, 'NO')} className="flex items-center justify-center gap-1.5 bg-polyred text-white py-3.5 rounded-xl font-bold shadow-md shadow-red-500/20 tap-feedback">
            <XCircle size={19} strokeWidth={2.5} /> Gana {sideLabel('NO')}
          </button>
        </div>
      ) : (
        <p className={`mt-3 text-center text-sm font-bold py-2 rounded-xl ${market.outcome === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'}`}>
          Ganó «{sideLabel(market.outcome)}»
        </p>
      )}
    </div>
  )
}

function WinnerSheet({ list, onPick, onClose }) {
  const open = list.filter((m) => m.state !== 'resolved')
  return (
    <Sheet open onClose={onClose} title={list[0].group_topic} subtitle="¿Quién ganó?">
      <div className="space-y-2 pb-4">
        {open.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              onClose()
              onPick(m)
            }}
            className="w-full flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 font-bold text-gray-900 tap-feedback"
          >
            <span className="truncate">{m.question}</span>
            <span className="text-polygreen text-sm flex items-center gap-1">
              <Trophy size={16} /> Gana
            </span>
          </button>
        ))}
        <button
          onClick={() => {
            onClose()
            onPick(null)
          }}
          className="w-full py-3 rounded-2xl bg-gray-100 text-gray-600 font-bold"
        >
          Ninguna gana
        </button>
      </div>
    </Sheet>
  )
}

export default function MarketsTab() {
  const { isOwner } = useAuth()
  const { markets: allMarkets, marketsLoaded } = useGame()
  const { canManage } = useManage()
  const markets = useMemo(() => allMarkets.filter(canManage), [allMarkets, canManage])
  const actions = useMarketActions()
  const [filter, setFilter] = useState('open')
  const [more, setMore] = useState(null) // mercado con el menú de acciones abierto
  const [pickWinner, setPickWinner] = useState(null) // lista de opciones de un grupo

  const counts = useMemo(() => {
    const c = { open: 0, pending: 0, resolved: 0 }
    for (const m of markets) c[m.state] += 1
    return c
  }, [markets])

  const view = useMemo(() => {
    const list = markets.filter((m) => m.state === filter).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    const singles = []
    const byGroup = new Map()
    for (const m of list) {
      if (m.group_id) {
        if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, [])
        byGroup.get(m.group_id).push(m)
      } else singles.push(m)
    }
    return { singles, groups: [...byGroup.entries()] }
  }, [markets, filter])

  const empty = marketsLoaded && view.singles.length === 0 && view.groups.length === 0
  const run = (fn) => () => {
    const m = more
    setMore(null)
    fn(m)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`flex-shrink-0 h-10 px-4 rounded-full text-sm font-semibold border ${
              filter === id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {label} <span className="opacity-60">{counts[id]}</span>
          </button>
        ))}
      </div>

      {!isOwner && <p className="text-xs text-gray-500">Como moderador, aquí ves y manejas solo los mercados que tú creaste.</p>}

      {empty && <p className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-200">No hay mercados en esta lista.</p>}

      <div className="space-y-3">
        {view.singles.map((m) => (
          <MarketCard key={m.id} market={m} onMore={setMore} onResolve={actions.resolve} />
        ))}
        {view.groups.map(([gid, list]) => (
          <div key={gid} className="bg-blue-50/50 border border-blue-100 rounded-3xl p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="font-extrabold text-gray-900 leading-snug">{list[0].group_topic}</h3>
              {filter !== 'resolved' && (
                <button onClick={() => setPickWinner(list)} className="text-xs font-bold text-white bg-polygreen rounded-full px-3 py-2 flex-shrink-0 flex items-center gap-1 tap-feedback">
                  <Trophy size={13} /> ¿Quién ganó?
                </button>
              )}
            </div>
            {list.map((m) => (
              <MarketCard key={m.id} market={m} onMore={setMore} onResolve={actions.resolve} />
            ))}
          </div>
        ))}
      </div>

      {more && (
        <Sheet open onClose={() => setMore(null)} title={more.group_topic ? `${more.group_topic} — ${more.question}` : more.question} subtitle="Acciones">
          <div className="divide-y divide-gray-100 pb-3">
            <ActionRow icon={Pencil} label="Editar" hint="Texto, foto, categoría, fecha de cierre" onClick={run(actions.edit)} />
            {more.state === 'open' && (
              <ActionRow icon={Lock} label="Cerrar apuestas ahora" hint="Queda esperando el resultado" tone="text-amber-700" onClick={run((m) => actions.closeNow(m, false))} />
            )}
            {more.state === 'open' && more.group_id && (
              <ActionRow icon={Lock} label="Cerrar apuestas de todo el grupo" tone="text-amber-700" onClick={run((m) => actions.closeNow(m, true))} />
            )}
            {isOwner && more.state === 'resolved' && (
              <ActionRow icon={RotateCcw} label="Deshacer la resolución" hint="Devuelve los pagos y reabre el mercado" tone="text-gray-800" onClick={run(actions.reopen)} />
            )}
            {isOwner && (
              <ActionRow icon={Trash2} label="Anular y borrar" hint="Devuelve el dinero y borra el mercado" tone="text-red-600" onClick={run(actions.annul)} />
            )}
          </div>
        </Sheet>
      )}

      {pickWinner && <WinnerSheet list={pickWinner} onClose={() => setPickWinner(null)} onPick={(winner) => actions.resolveGroup(pickWinner, winner)} />}
      {actions.editor}
    </div>
  )
}
