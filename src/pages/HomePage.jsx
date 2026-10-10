import { useLayoutEffect, useMemo, useState } from 'react'
import { useNavigate, useNavigationType } from 'react-router-dom'
import { ChevronDown, Flame, Lightbulb, Plus, SearchX, TrendingUp } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useActivity } from '../hooks/useActivity'
import { matchesQuery, SORTS } from '../lib/markets'
import { yesPrice } from '../lib/trading'
import MarketCard, { GroupCard } from '../components/MarketCard'
import { ActivityTicker } from '../components/ActivityFeed'
import { CategoryChips, SearchBar, SortTabs } from '../components/SearchControls'
import ChanceRing from '../components/ChanceRing'
import MarketImage from '../components/MarketImage'
import YesNoButtons from '../components/YesNoButtons'
import { ListSkeleton } from '../components/ui/Skeleton'
import { useTrade } from '../components/TradeSheet'

// Los filtros y la posición de scroll se recuerdan mientras la app está abierta:
// al volver de un mercado, la lista queda como estaba.
const memory = { query: '', category: 'all', sort: 'trending', scroll: 0, showResolved: false }

const RESOLVED_PAGE = 12

function FeaturedCard({ item, onTrade }) {
  const navigate = useNavigate()
  const go = () => navigate(item.kind === 'group' ? `/g/${item.id}` : `/m/${item.id}`)
  const lead = item.kind === 'group' ? item.markets[0] : item.market
  return (
    <article
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => e.key === 'Enter' && go()}
      className="snap-start flex-shrink-0 w-[272px] sm:w-[300px] bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden cursor-pointer tap-feedback"
    >
      <div className="relative">
        <MarketImage item={item} variant="banner" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent" />
        <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 text-xs font-extrabold text-white bg-orange-500 rounded-full px-2.5 py-1 shadow">
          <Flame size={12} /> Tendencia
        </span>
      </div>
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <h3 className="flex-1 font-semibold text-[15px] leading-snug text-gray-900 line-clamp-2 min-h-[40px]">{item.title}</h3>
          <ChanceRing value={yesPrice(lead)} size={46} stroke={4.5} />
        </div>
        <div className="mt-2.5">
          {item.kind === 'single' ? (
            <YesNoButtons market={item.market} onPick={onTrade} />
          ) : (
            <p className="text-sm text-gray-500 text-center py-2.5 rounded-xl bg-gray-50">
              {item.markets.length} opciones · lidera <b className="text-gray-700">{lead.question}</b>
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

function Section({ title, count, children, tone }) {
  return (
    <section className="space-y-3">
      <h2 className={`text-sm font-extrabold uppercase tracking-wider flex items-center gap-2 ${tone || 'text-gray-500'}`}>
        {title}
        {count !== undefined && <span className="text-xs font-bold bg-gray-200 text-gray-600 rounded-full px-2 py-0.5">{count}</span>}
      </h2>
      {children}
    </section>
  )
}

const Grid = ({ children }) => <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">{children}</div>

export default function HomePage() {
  const { isStaff } = useAuth()
  const { activeItems, resolvedItems, marketsLoaded } = useGame()
  const { openTrade } = useTrade()
  const navigate = useNavigate()
  const navType = useNavigationType()
  const { events } = useActivity({ limit: 30 })

  const [query, setQueryState] = useState(memory.query)
  const [category, setCategoryState] = useState(memory.category)
  const [sort, setSortState] = useState(memory.sort)
  const [showResolved, setShowResolvedState] = useState(memory.showResolved)
  const [resolvedLimit, setResolvedLimit] = useState(RESOLVED_PAGE)

  const setQuery = (v) => {
    memory.query = v
    setQueryState(v)
  }
  const setCategory = (v) => {
    memory.category = v
    setCategoryState(v)
  }
  const setSort = (v) => {
    memory.sort = v
    setSortState(v)
  }
  const setShowResolved = (v) => {
    memory.showResolved = v
    setShowResolvedState(v)
  }

  // Recupera el scroll al volver con "atrás"; lo guarda al salir.
  useLayoutEffect(() => {
    if (navType === 'POP' && memory.scroll > 0) window.scrollTo(0, memory.scroll)
    return () => {
      memory.scroll = window.scrollY
    }
  }, [navType])

  const filtering = query.trim() !== '' || category !== 'all'

  const matches = (i) => (category === 'all' || i.category === category) && matchesQuery(i, query)

  const open = useMemo(
    () => activeItems.filter((i) => i.state === 'open' && matches(i)).sort(SORTS[sort].fn),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeItems, query, category, sort]
  )
  const upcoming = useMemo(
    () => activeItems.filter((i) => i.state === 'upcoming' && matches(i)).sort((a, b) => Date.parse(a.opens_at) - Date.parse(b.opens_at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeItems, query, category]
  )
  const pending = useMemo(
    () => activeItems.filter((i) => i.state === 'pending' && matches(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeItems, query, category]
  )
  const resolved = useMemo(
    () => resolvedItems.filter(matches),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedItems, query, category]
  )

  const counts = useMemo(() => {
    const c = {}
    for (const i of [...activeItems, ...resolvedItems]) c[i.category] = (c[i.category] || 0) + 1
    return c
  }, [activeItems, resolvedItems])

  // "En tendencia": los más movidos en las últimas horas.
  const trending = useMemo(
    () =>
      activeItems
        .filter((i) => i.state === 'open' && i.score >= 8)
        .sort(SORTS.trending.fn)
        .slice(0, 5),
    [activeItems]
  )
  const hotKeys = useMemo(() => new Set(trending.slice(0, 3).map((i) => i.key)), [trending])
  const showFeatured = !filtering && trending.length >= 2

  const nothingAtAll = marketsLoaded && activeItems.length === 0 && resolvedItems.length === 0
  const noResults = marketsLoaded && !nothingAtAll && open.length + upcoming.length + pending.length + resolved.length === 0

  const renderItem = (item) =>
    item.kind === 'group' ? (
      <GroupCard key={item.key} item={item} hot={hotKeys.has(item.key)} onTrade={openTrade} />
    ) : (
      <MarketCard key={item.key} item={item} hot={hotKeys.has(item.key)} onTrade={openTrade} />
    )

  return (
    <div className="max-w-5xl mx-auto px-4 pt-4 pb-8 space-y-4">
      <div className="space-y-3 sticky z-20 -mx-4 px-4 py-2 bg-polygray-bg" style={{ top: 'calc(56px + env(safe-area-inset-top))' }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Buscar: «lluvia», «papá», «comida»…" />
        <CategoryChips value={category} onChange={setCategory} counts={counts} />
      </div>

      {!marketsLoaded && <ListSkeleton rows={4} />}

      {nothingAtAll && (
        <div className="text-center py-14 bg-white rounded-3xl border border-gray-200 animate-fade-in">
          <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <TrendingUp size={38} className="text-polyblue" strokeWidth={1.8} />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Aún no hay mercados</h2>
          <p className="text-gray-500 text-sm mt-1 px-8">
            Cuando alguien cree uno aparecerá aquí al instante. ¿Tienes una idea buena?
          </p>
          <button
            onClick={() => navigate('/sugerir')}
            className="mt-5 inline-flex items-center gap-2 bg-polyblue text-white font-bold px-5 py-3 rounded-xl shadow-lg shadow-blue-500/20"
          >
            <Lightbulb size={18} /> Sugerir un mercado
          </button>
        </div>
      )}

      {marketsLoaded && !nothingAtAll && !filtering && <ActivityTicker events={events} />}

      {showFeatured && (
        <Section title="🔥 En tendencia">
          <div className="-mx-4 px-4 scroll-pl-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
            <div className="flex gap-3 w-max pr-4 pb-1">
              {trending.map((item) => (
                <FeaturedCard key={item.key} item={item} onTrade={openTrade} />
              ))}
            </div>
          </div>
        </Section>
      )}

      {marketsLoaded && !nothingAtAll && (
        <>
          <SortTabs value={sort} onChange={setSort} />

          {noResults && (
            <div className="text-center py-12 bg-white rounded-3xl border border-gray-200 animate-fade-in">
              <SearchX size={42} className="mx-auto text-gray-300 mb-3" />
              <p className="font-semibold text-gray-700">Nada coincide con tu búsqueda</p>
              <button
                onClick={() => {
                  setQuery('')
                  setCategory('all')
                }}
                className="mt-3 text-polyblue font-bold text-sm"
              >
                Quitar filtros
              </button>
            </div>
          )}

          {open.length > 0 && <Grid>{open.map(renderItem)}</Grid>}
          {open.length === 0 && !noResults && upcoming.length === 0 && pending.length === 0 && resolved.length > 0 && (
            <p className="text-center text-sm text-gray-400 py-6">No hay mercados abiertos ahora mismo.</p>
          )}

          {upcoming.length > 0 && (
            <Section title="🗓️ Próximamente" count={upcoming.length} tone="text-violet-600">
              <Grid>{upcoming.map(renderItem)}</Grid>
            </Section>
          )}

          {pending.length > 0 && (
            <Section title="⏳ Esperando resultado" count={pending.length} tone="text-amber-600">
              <Grid>{pending.map(renderItem)}</Grid>
            </Section>
          )}

          {resolved.length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setShowResolved(!showResolved)}
                aria-expanded={showResolved}
                className="w-full flex items-center justify-between bg-white rounded-2xl border border-gray-200 px-4 py-3.5 shadow-card"
              >
                <span className="font-bold text-gray-800 flex items-center gap-2">
                  Finalizados
                  <span className="text-xs font-bold bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{resolved.length}</span>
                </span>
                <ChevronDown size={20} className={`text-gray-400 transition-transform ${showResolved ? 'rotate-180' : ''}`} />
              </button>
              {showResolved && (
                <>
                  <Grid>{resolved.slice(0, resolvedLimit).map(renderItem)}</Grid>
                  {resolved.length > resolvedLimit && (
                    <button
                      onClick={() => setResolvedLimit((n) => n + RESOLVED_PAGE)}
                      className="w-full py-3 text-sm font-bold text-polyblue"
                    >
                      Ver más ({resolved.length - resolvedLimit})
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}

      {isStaff && (
        <button
          onClick={() => navigate('/admin', { state: { tab: 'create' } })}
          className="fixed right-4 z-30 flex items-center gap-2 bg-polyblue text-white font-bold pl-4 pr-5 h-14 rounded-full shadow-lift shadow-blue-500/40 tap-feedback"
          style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
          aria-label="Crear mercado"
        >
          <Plus size={22} strokeWidth={2.8} /> Crear
        </button>
      )}
    </div>
  )
}
