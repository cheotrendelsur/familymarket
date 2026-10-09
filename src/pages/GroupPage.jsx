import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Lock, SearchX, XCircle } from 'lucide-react'
import { useGame } from '../context/GameContext'
import { useActivity } from '../hooks/useActivity'
import { useMyPositions } from '../hooks/useMyPositions'
import { buildPosition } from '../lib/portfolio'
import { sideLabel } from '../lib/format'
import { yesPrice } from '../lib/trading'
import ActivityFeed from '../components/ActivityFeed'
import ClosingBanner from '../components/ClosingBanner'
import { CategoryTag } from '../components/MarketCard'
import { StateBadge } from '../components/Countdown'
import { BackButton, PositionStrip } from '../components/DetailParts'
import MarketImage from '../components/MarketImage'
import { GroupChart } from '../components/PriceCharts'
import StaffBar from '../components/StaffBar'
import { Skeleton } from '../components/ui/Skeleton'
import YesNoButtons from '../components/YesNoButtons'
import { useTrade } from '../components/TradeSheet'

function OptionLine({ market, rank, onTrade, onOpen, mine }) {
  const yes = yesPrice(market)
  const resolved = market.state === 'resolved'
  const pending = market.state === 'pending'
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-extrabold flex items-center justify-center flex-shrink-0">{rank}</span>
        <button onClick={onOpen} className="flex-1 min-w-0 text-left">
          <span className="font-semibold text-gray-900 block truncate">{market.question}</span>
          {mine && <span className="text-[11px] font-bold text-polyblue">Tienes acciones aquí</span>}
        </button>
        <span className="font-black text-xl tabular-nums">{Math.round(yes * 100)}%</span>
        <button onClick={onOpen} aria-label="Ver detalle" className="p-1 text-gray-300">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mt-2.5 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${resolved ? (market.outcome === 'YES' ? 'bg-polygreen' : 'bg-gray-300') : 'bg-polygreen'}`}
          style={{ width: `${Math.round(yes * 100)}%` }}
        />
      </div>
      <div className="mt-3">
        {resolved ? (
          <div
            className={`flex items-center justify-center gap-2 py-2 rounded-xl font-bold text-sm ${
              market.outcome === 'YES' ? 'bg-emerald-50 text-polygreen' : 'bg-rose-50 text-polyred'
            }`}
          >
            {market.outcome === 'YES' ? <CheckCircle2 size={16} /> : <XCircle size={16} />} Ganó «{sideLabel(market.outcome)}»
          </div>
        ) : pending ? (
          <div className="flex items-center justify-center gap-2 py-2 rounded-xl font-semibold text-sm bg-amber-50 text-amber-800">
            <Lock size={15} /> Apuestas cerradas
          </div>
        ) : (
          <YesNoButtons market={market} onPick={onTrade} />
        )}
      </div>
    </div>
  )
}

export default function GroupPage() {
  const { groupId } = useParams()
  const { itemsByKey, marketsLoaded } = useGame()
  const { openTrade } = useTrade()
  const navigate = useNavigate()
  const item = itemsByKey.get(`g:${groupId}`)
  const { raw } = useMyPositions({ enabled: !!item })
  const { events } = useActivity({ limit: 10, groupId, enabled: !!item })

  const positions = useMemo(() => {
    if (!raw || !item) return []
    const byId = new Map(item.markets.map((m) => [m.id, m]))
    return raw.filter((p) => byId.has(p.market_id)).map((p) => buildPosition(p, byId.get(p.market_id)))
  }, [raw, item])
  const mineIds = useMemo(() => new Set(positions.map((p) => p.marketId)), [positions])

  if (!item) {
    if (!marketsLoaded) {
      return (
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="w-full aspect-[16/9] rounded-3xl" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-[220px] rounded-2xl" />
        </div>
      )
    }
    return (
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <BackButton />
        <div className="text-center py-16 bg-white rounded-3xl border border-gray-200 mt-3">
          <SearchX size={44} className="mx-auto text-gray-300 mb-3" />
          <h2 className="font-bold text-gray-900">Este mercado ya no está disponible</h2>
          <Link to="/" className="inline-block mt-4 text-polyblue font-bold">
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  const live = item.state !== 'resolved'
  const winners = item.markets.filter((m) => m.state === 'resolved' && m.outcome === 'YES')

  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 pb-10 space-y-5">
      <ClosingBanner state={item.state} />
      <BackButton />

      <div className="rounded-3xl overflow-hidden border border-gray-200 shadow-card bg-white">
        <MarketImage item={item} variant="banner" priority />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
          <CategoryTag category={item.category} />
          <StateBadge item={item} />
          <span className="text-xs font-semibold text-gray-400">{item.markets.length} opciones</span>
        </div>
        <h1 className="text-[22px] leading-snug font-extrabold text-gray-900">{item.title}</h1>
        {item.description && <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{item.description}</p>}
      </div>

      {item.state === 'resolved' && winners.length > 0 && (
        <div className="rounded-3xl p-5 bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 animate-pop">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">Ganó</p>
          <p className="text-2xl font-extrabold text-polygreen">{winners.map((m) => m.question).join(' · ')}</p>
        </div>
      )}

      <StaffBar group={item.markets} />

      <section className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        <GroupChart groupId={groupId} options={item.markets} live={live} />
      </section>

      <section className="space-y-2">
        <h2 className="font-bold text-gray-900">Opciones</h2>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100 overflow-hidden">
          {item.markets.map((m, i) => (
            <OptionLine
              key={m.id}
              market={m}
              rank={i + 1}
              mine={mineIds.has(m.id)}
              onTrade={openTrade}
              onOpen={() => navigate(`/m/${m.id}`)}
            />
          ))}
        </div>
      </section>

      {positions.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold text-gray-900">Tus posiciones aquí</h2>
          <PositionStrip positions={positions.map((p) => ({ ...p, key: `${p.key}` }))} onSell={null} />
          <p className="text-xs text-gray-400">Entra a cada opción para venderlas.</p>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        <h2 className="font-bold text-gray-900 mb-1">Movimientos recientes</h2>
        <ActivityFeed events={events} emptyText="Nadie ha operado aquí todavía. ¡Sé el primero!" />
      </section>
    </div>
  )
}
