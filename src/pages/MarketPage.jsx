import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Layers, SearchX } from 'lucide-react'
import { useGame } from '../context/GameContext'
import { useActivity } from '../hooks/useActivity'
import { useMyPositions } from '../hooks/useMyPositions'
import { buildPosition } from '../lib/portfolio'
import { cents, sideLabel } from '../lib/format'
import { yesPrice, noPrice } from '../lib/trading'
import ActivityFeed from '../components/ActivityFeed'
import ClosingBanner from '../components/ClosingBanner'
import { CategoryTag } from '../components/MarketCard'
import { StateBadge } from '../components/Countdown'
import { ActionBar, BackButton, PendingBlock, PositionStrip, ProbabilityHeader, ResultBlock } from '../components/DetailParts'
import MarketImage from '../components/MarketImage'
import { PriceChart } from '../components/PriceCharts'
import { Skeleton } from '../components/ui/Skeleton'
import { useTrade } from '../components/TradeSheet'

export default function MarketPage() {
  const { id } = useParams()
  const { marketsById, itemsByKey, marketsLoaded } = useGame()
  const { openTrade } = useTrade()
  const navigate = useNavigate()
  const market = marketsById.get(id)
  const { raw } = useMyPositions({ enabled: !!market })
  const { events } = useActivity({ limit: 10, marketId: id, enabled: !!market })

  const positions = useMemo(
    () => (raw && market ? raw.filter((p) => p.market_id === id).map((p) => buildPosition(p, market)) : []),
    [raw, market, id]
  )
  const groupItem = market?.group_id ? itemsByKey.get(`g:${market.group_id}`) : null
  const siblings = groupItem ? groupItem.markets.filter((m) => m.id !== id) : []

  if (!market) {
    if (!marketsLoaded) {
      return (
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="w-full aspect-[16/9] rounded-3xl" />
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-[200px] rounded-2xl" />
        </div>
      )
    }
    return (
      <div className="max-w-2xl mx-auto px-4 pt-4">
        <BackButton />
        <div className="text-center py-16 bg-white rounded-3xl border border-gray-200 mt-3">
          <SearchX size={44} className="mx-auto text-gray-300 mb-3" />
          <h2 className="font-bold text-gray-900">Este mercado ya no está disponible</h2>
          <p className="text-sm text-gray-500 mt-1">Pudo haber sido anulado o no tienes acceso.</p>
          <Link to="/" className="inline-block mt-4 text-polyblue font-bold">
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  const yes = yesPrice(market)
  const no = noPrice(market)
  const open = market.state === 'open'
  const item = { kind: 'single', state: market.state, market, closes_at: market.state === 'open' ? market.closes_at : null }
  const owned = positions.length > 0

  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 pb-36 space-y-5">
      <ClosingBanner state={market.state} />
      <BackButton />

      <div className="rounded-3xl overflow-hidden border border-gray-200 shadow-card bg-white">
        <MarketImage item={market} variant="banner" priority />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
          <CategoryTag category={market.category} />
          <StateBadge item={item} />
        </div>
        <h1 className="text-[22px] leading-snug font-extrabold text-gray-900">
          {market.group_topic ? (
            <>
              <span className="block text-sm font-semibold text-gray-400 mb-0.5">{market.group_topic}</span>
              {market.question}
            </>
          ) : (
            market.question
          )}
        </h1>
        {market.state !== 'resolved' && <ProbabilityHeader yes={yes} yes24={market.yes_price_24h == null ? null : Number(market.yes_price_24h)} />}
      </div>

      {market.state === 'resolved' && <ResultBlock market={market} />}
      {market.state === 'pending' && <PendingBlock />}

      <section className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        <PriceChart marketId={id} currentYes={yes} live={market.state !== 'resolved'} />
      </section>

      {owned && (
        <section className="space-y-2">
          <h2 className="font-bold text-gray-900">Tu posición</h2>
          <PositionStrip positions={positions} onSell={(side) => openTrade(id, side, 'SELL')} />
        </section>
      )}

      {market.description && (
        <section className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
          <h2 className="font-bold text-gray-900 mb-1.5">Sobre este mercado</h2>
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-line">{market.description}</p>
          <p className="text-xs text-gray-400 mt-3">
            Si gana tu opción, cada acción paga $1.00. El resultado lo confirma un administrador.
          </p>
        </section>
      )}

      {groupItem && siblings.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-gray-900 flex items-center gap-2">
              <Layers size={17} className="text-gray-400" /> Otras opciones
            </h2>
            <Link to={`/g/${groupItem.id}`} className="text-sm font-bold text-polyblue">
              Ver todas
            </Link>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100">
            {siblings.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(`/m/${m.id}`)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex-1 font-medium text-gray-800 truncate">{m.question}</span>
                <span className="font-extrabold tabular-nums">{Math.round(yesPrice(m) * 100)}%</span>
                <ChevronRight size={16} className="text-gray-300" />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        <h2 className="font-bold text-gray-900 mb-1">Movimientos recientes</h2>
        <ActivityFeed events={events} showMarket={false} emptyText="Nadie ha operado aquí todavía. ¡Sé el primero!" />
      </section>

      {open && (
        <ActionBar>
          <div className="flex gap-3">
            <button
              onClick={() => openTrade(id, 'YES')}
              className="flex-1 h-14 rounded-2xl bg-polygreen text-white font-extrabold text-base shadow-lg shadow-green-500/30 tap-feedback"
            >
              Comprar {sideLabel('YES')} · {cents(yes, 0)}
            </button>
            <button
              onClick={() => openTrade(id, 'NO')}
              className="flex-1 h-14 rounded-2xl bg-polyred text-white font-extrabold text-base shadow-lg shadow-red-500/30 tap-feedback"
            >
              Comprar {sideLabel('NO')} · {cents(no, 0)}
            </button>
          </div>
        </ActionBar>
      )}
    </div>
  )
}
