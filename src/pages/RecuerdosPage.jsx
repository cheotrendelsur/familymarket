import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Calendar, CheckCircle, Crown, History, Users, XCircle } from 'lucide-react'
import { rpc } from '../lib/api'
import { buildPosition, groupPositions } from '../lib/portfolio'
import { dateShort, friendlyError, money } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useToggleSet } from '../hooks/useToggleSet'
import GroupAccordion from '../components/GroupAccordion'
import Leaderboard from '../components/Leaderboard'
import OperationsList from '../components/OperationsList'
import PageLoader, { Spinner } from '../components/PageLoader'
import PositionCard from '../components/PositionCard'

function ErrorBox({ text }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{text}</div>
}

function SeasonCard({ season, onOpen }) {
  return (
    <button
      onClick={() => onOpen(season.slug)}
      className="w-full text-left bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5"
    >
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-md flex-shrink-0">
          <Crown size={28} className="text-white" strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 leading-snug">{season.title}</h3>
          <p className="text-sm text-gray-500 flex items-center gap-1.5 mt-0.5">
            <Calendar size={14} /> {dateShort(season.played_from)} — {dateShort(season.played_to)}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm text-gray-600">
            <span className="flex items-center gap-1.5">
              <Users size={15} /> {season.players} jugadores
            </span>
            <span>{season.markets} mercados</span>
          </div>
          {season.champion && (
            <div className="mt-3 inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-1.5 text-sm">
              <Crown size={15} className="text-yellow-600" />
              <span className="font-bold text-yellow-800">{season.champion}</span>
              <span className="text-yellow-700">{money(season.champion_net_worth)}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function PlayerDetail({ slug, player }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('positions')
  const [open, toggle] = useToggleSet()

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    rpc('get_season_player', { p_slug: slug, p_user_id: player.user_id })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(friendlyError(e)))
    return () => {
      cancelled = true
    }
  }, [slug, player.user_id])

  const positions = useMemo(() => (data ? data.positions.map((p) => buildPosition(p)) : []), [data])
  const { particular, groups } = useMemo(() => groupPositions(positions), [positions])
  const operations = useMemo(
    () => (data ? data.operations.map((o) => ({ ...o, id: undefined })) : []),
    [data]
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-5">
      <div>
        <h3 className="text-xl font-bold text-gray-900">{player.username}</h3>
        <p className="text-sm text-gray-500">
          Puesto #{player.rank} · Patrimonio final {money(player.net_worth)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1">
        {[
          ['positions', 'Portafolio'],
          ['ops', 'Operaciones'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`py-2.5 rounded-md font-semibold transition-all ${tab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}
          >
            {label}
            {data && (
              <span className="ml-1.5 text-xs text-gray-400">
                {key === 'positions' ? positions.length : operations.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <ErrorBox text={error} />}
      {!data && !error && (
        <div className="py-10">
          <Spinner />
        </div>
      )}

      {data && tab === 'positions' &&
        (positions.length === 0 ? (
          <p className="text-center text-gray-500 py-8">Sin posiciones al final de la partida</p>
        ) : (
          <div className="space-y-4">
            {particular.map((p) => (
              <PositionCard key={p.key} position={p} />
            ))}
            {groups.map(([topic, list]) => (
              <GroupAccordion
                key={topic}
                topic={`🎯 ${topic}`}
                count={list.length}
                tone="gray"
                hintOpen="Ocultar"
                hintClosed="Toca para ver"
                open={!!open[topic]}
                onToggle={() => toggle(topic)}
              >
                {list.map((p) => (
                  <PositionCard key={p.key} position={p} />
                ))}
              </GroupAccordion>
            ))}
          </div>
        ))}

      {data && tab === 'ops' && <OperationsList ops={operations} emptyText="Este jugador no hizo operaciones" />}
    </div>
  )
}

function SeasonDetail({ slug, onBack }) {
  const { profile } = useAuth()
  const [season, setSeason] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [openTopics, toggleTopic] = useToggleSet()

  useEffect(() => {
    let cancelled = false
    rpc('get_season', { p_slug: slug })
      .then((d) => !cancelled && setSeason(d))
      .catch((e) => !cancelled && setError(friendlyError(e)))
    return () => {
      cancelled = true
    }
  }, [slug])

  const grouped = useMemo(() => {
    if (!season) return { particular: [], groups: [] }
    const particular = []
    const groups = new Map()
    for (const m of season.markets) {
      if (m.group_topic) {
        if (!groups.has(m.group_topic)) groups.set(m.group_topic, [])
        groups.get(m.group_topic).push(m)
      } else particular.push(m)
    }
    return { particular, groups: [...groups.entries()] }
  }, [season])

  const MarketRow = ({ m }) => (
    <div className="bg-white rounded-lg p-3 border border-gray-200 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800 leading-snug">{m.question}</p>
        <p className="text-xs text-gray-400 mt-0.5">{m.trades} operaciones</p>
      </div>
      <div
        className={`flex items-center gap-1.5 text-sm font-bold flex-shrink-0 ${
          m.outcome === 'YES' ? 'text-polygreen' : m.outcome === 'NO' ? 'text-polyred' : 'text-gray-500'
        }`}
      >
        {m.outcome === 'YES' ? <CheckCircle size={16} /> : m.outcome === 'NO' ? <XCircle size={16} /> : null}
        {m.closed ? `Ganó ${m.outcome}` : 'Sin resolver'}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-polyblue font-semibold">
        <ArrowLeft size={18} /> Todos los recuerdos
      </button>

      {error && <ErrorBox text={error} />}
      {!season && !error && <PageLoader label="Abriendo el recuerdo..." />}

      {season && (
        <>
          <div className="bg-gradient-to-br from-amber-500 to-yellow-500 rounded-2xl p-6 text-white shadow-xl">
            <p className="text-xs font-bold uppercase tracking-wider opacity-90 mb-1 flex items-center gap-1.5">
              <History size={14} /> Recuerdo
            </p>
            <h2 className="text-2xl font-bold leading-snug">{season.season.title}</h2>
            <p className="text-sm opacity-90 mt-1">
              {dateShort(season.season.played_from)} — {dateShort(season.season.played_to)}
            </p>
            {season.ranking[0] && (
              <div className="mt-4 flex items-center gap-3 bg-white/20 rounded-xl p-3">
                <Crown size={28} />
                <div>
                  <div className="text-xs opacity-90">Campeón</div>
                  <div className="font-bold text-lg leading-tight">
                    {season.ranking[0].username} · {money(season.ranking[0].net_worth)}
                  </div>
                </div>
              </div>
            )}
          </div>

          <section>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Ranking final</h3>
            <p className="text-sm text-gray-500 mb-3">Toca a un jugador para ver su portafolio y todas sus operaciones.</p>
            <Leaderboard
              rows={season.ranking}
              meId={profile?.id}
              onSelect={setSelected}
              selectedId={selected?.user_id}
            />
          </section>

          {selected && (
            <section>
              <PlayerDetail slug={slug} player={selected} />
            </section>
          )}

          <section>
            <h3 className="text-xl font-bold text-gray-900 mb-3">Mercados ({season.markets.length})</h3>
            <div className="space-y-3">
              {grouped.particular.map((m) => (
                <MarketRow key={m.id} m={m} />
              ))}
              {grouped.groups.map(([topic, list]) => (
                <GroupAccordion
                  key={topic}
                  topic={topic}
                  count={list.length}
                  tone="gray"
                  hintOpen="Ocultar resultados"
                  hintClosed="Toca para ver resultados"
                  open={!!openTopics[topic]}
                  onToggle={() => toggleTopic(topic)}
                >
                  {list.map((m) => (
                    <MarketRow key={m.id} m={m} />
                  ))}
                </GroupAccordion>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default function RecuerdosPage() {
  const [seasons, setSeasons] = useState(null)
  const [error, setError] = useState(null)
  const [slug, setSlug] = useState(null)

  const load = useCallback(async () => {
    try {
      setSeasons((await rpc('list_seasons')) || [])
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="min-h-screen-safe bg-polygray-bg px-4 py-6">
      <div className="max-w-3xl mx-auto">
        {slug ? (
          <SeasonDetail slug={slug} onBack={() => setSlug(null)} />
        ) : (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                <History size={26} className="text-amber-500" /> Recuerdos
              </h2>
              <p className="text-sm text-gray-600 mt-1">Las partidas anteriores quedan guardadas para siempre.</p>
            </div>
            {error && <ErrorBox text={error} />}
            {!seasons && !error && <PageLoader label="Cargando recuerdos..." />}
            {seasons && seasons.length === 0 && (
              <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                <History size={56} className="mx-auto text-gray-300 mb-3" />
                <p className="text-gray-600">Todavía no hay partidas archivadas.</p>
              </div>
            )}
            {seasons?.map((s) => (
              <SeasonCard key={s.id} season={s} onOpen={setSlug} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
