import { useMemo, useState } from 'react'
import { Briefcase, CheckCircle, DollarSign, GraduationCap, History, TrendingUp, Vibrate, Volume2, VolumeX, Zap } from 'lucide-react'
import { db } from '../lib/api'
import { buildPosition, groupPositions } from '../lib/portfolio'
import { money } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useMyPositions } from '../hooks/useMyPositions'
import { useToggleSet } from '../hooks/useToggleSet'
import { haptic, hapticsEnabled, playSound, setHapticsEnabled, setSoundEnabled, soundEnabled } from '../lib/fx'
import GroupAccordion from '../components/GroupAccordion'
import OperationsList from '../components/OperationsList'
import PositionCard from '../components/PositionCard'
import AnimatedNumber from '../components/ui/AnimatedNumber'
import { Skeleton } from '../components/ui/Skeleton'

function PositionSections({ positions, tone, open, toggle }) {
  const { particular, groups } = useMemo(() => groupPositions(positions), [positions])
  return (
    <div className="space-y-4">
      {particular.length > 0 && (
        <div className="space-y-3">
          {particular.map((p) => (
            <PositionCard key={p.key} position={p} linkTo={`/m/${p.marketId}`} />
          ))}
        </div>
      )}
      {groups.map(([topic, list]) => (
        <GroupAccordion
          key={topic}
          topic={`🎯 ${topic}`}
          count={list.length}
          tone={tone}
          hintOpen="Ocultar"
          hintClosed="Toca para ver tus posiciones"
          open={!!open[topic]}
          onToggle={() => toggle(topic)}
        >
          {list.map((p) => (
            <PositionCard key={p.key} position={p} linkTo={`/m/${p.marketId}`} />
          ))}
        </GroupAccordion>
      ))}
    </div>
  )
}

function Toggle({ on, onChange, icon: Icon, label }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold border transition-colors ${
        on ? 'bg-blue-50 border-blue-200 text-polyblue' : 'bg-white border-gray-200 text-gray-400'
      }`}
    >
      <Icon size={17} /> {label}: {on ? 'sí' : 'no'}
    </button>
  )
}

export default function PortfolioPage() {
  const { profile, startTourReplay } = useAuth()
  const { marketsById, config, daily } = useGame()
  const { raw, refresh } = useMyPositions({ interval: 45000, enabled: !!profile })
  const [operations, setOperations] = useState([])
  const [showOps, setShowOps] = useState(false)
  const [openActive, toggleActive] = useToggleSet()
  const [openClosed, toggleClosed] = useToggleSet()
  const [sound, setSound] = useState(soundEnabled)
  const [vibration, setVibration] = useState(hapticsEnabled)

  const toggleOps = async () => {
    const next = !showOps
    setShowOps(next)
    if (next) {
      try {
        const data = await db.myOperations(100)
        setOperations(
          data.map((t) => ({
            id: t.id,
            at: t.created_at,
            question: t.markets?.group_topic ? `${t.markets.group_topic} — ${t.markets.question}` : t.markets?.question || 'Mercado',
            type: t.type,
            side: t.side,
            shares: t.shares_amount,
            price: t.price_per_share,
            total: t.total_cost,
          }))
        )
      } catch {
        setOperations([])
      }
    }
  }

  // Los precios vienen EN VIVO del contexto (se actualiza solo); aquí solo hay acciones y costo.
  const positions = useMemo(() => {
    if (!raw) return null
    return raw.map((p) => buildPosition(p, marketsById.get(p.market_id)))
  }, [raw, marketsById])

  const active = positions?.filter((p) => !p.closed) ?? []
  const closed = positions?.filter((p) => p.closed) ?? []
  const cash = profile?.balance ?? 0
  const inShares = active.reduce((sum, p) => sum + p.currentValue, 0)
  const remaining = daily?.remaining
  const limit = daily?.limit ?? config.daily_limit

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-6">
      <div className="bg-gradient-to-br from-polyblue to-blue-600 rounded-3xl p-5 text-white shadow-xl shadow-blue-500/20">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign size={18} strokeWidth={2.5} />
            <span className="text-sm font-semibold opacity-90">Valor total de la cuenta</span>
          </div>
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-sm border ${
              remaining !== undefined && remaining <= 5 ? 'bg-red-500/25 border-red-300' : 'bg-white/20 border-white/30'
            }`}
          >
            <Zap size={14} strokeWidth={2.5} />
            <span className="tabular-nums">
              {remaining ?? '…'}/{limit}
            </span>
          </div>
        </div>
        <div className="text-5xl font-black mb-4 tabular-nums">
          <AnimatedNumber value={cash + inShares} format={(v) => money(v)} />
        </div>
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/20">
          <div>
            <div className="text-xs opacity-75 mb-0.5">Efectivo disponible</div>
            <div className="text-xl font-bold tabular-nums">{money(cash)}</div>
          </div>
          <div>
            <div className="text-xs opacity-75 mb-0.5">En acciones activas</div>
            <div className="text-xl font-bold tabular-nums">{money(inShares)}</div>
          </div>
        </div>
      </div>

      <section>
        <div className="flex items-center gap-2.5 mb-3">
          <Briefcase size={22} className="text-gray-700" />
          <h2 className="text-xl font-extrabold text-gray-900">Posiciones activas</h2>
        </div>
        {!positions ? (
          <div className="space-y-3">
            <Skeleton className="h-[170px] rounded-2xl" />
            <Skeleton className="h-[170px] rounded-2xl" />
          </div>
        ) : active.length === 0 ? (
          <div className="text-center py-14 bg-white rounded-2xl border border-gray-200">
            <TrendingUp size={52} className="mx-auto text-gray-300 mb-3" strokeWidth={1.5} />
            <h3 className="font-semibold text-gray-900 mb-1">No tienes posiciones activas</h3>
            <p className="text-gray-500 text-sm">Compra acciones en Inicio para empezar a jugar</p>
          </div>
        ) : (
          <PositionSections positions={active} tone="blue" open={openActive} toggle={toggleActive} />
        )}
      </section>

      <section>
        <div className="flex items-center gap-2.5 mb-3">
          <CheckCircle size={22} className="text-gray-700" />
          <h2 className="text-xl font-extrabold text-gray-900">Historial de resultados</h2>
        </div>
        {closed.length === 0 ? (
          <div className="text-center py-10 bg-white rounded-2xl border border-gray-200 text-gray-500 text-sm">
            Aún no tienes resultados de mercados finalizados
          </div>
        ) : (
          <PositionSections positions={closed} tone="gray" open={openClosed} toggle={toggleClosed} />
        )}
      </section>

      <section>
        <button
          onClick={toggleOps}
          className="w-full flex items-center justify-between bg-white rounded-2xl border border-gray-200 px-5 py-4 shadow-card"
        >
          <span className="flex items-center gap-3 font-bold text-gray-900">
            <History size={20} className="text-gray-600" /> Historial de operaciones
          </span>
          <span className="text-sm font-semibold text-polyblue">{showOps ? 'Ocultar' : 'Ver'}</span>
        </button>
        {showOps && (
          <div className="mt-3">
            <OperationsList ops={operations} emptyText="Aún no has hecho operaciones" />
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Preferencias de este dispositivo</h2>
        <div className="flex gap-2">
          <Toggle
            on={sound}
            icon={sound ? Volume2 : VolumeX}
            label="Sonidos"
            onChange={(v) => {
              setSound(v)
              setSoundEnabled(v)
              if (v) playSound('success')
            }}
          />
          <Toggle
            on={vibration}
            icon={Vibrate}
            label="Vibración"
            onChange={(v) => {
              setVibration(v)
              setHapticsEnabled(v)
              if (v) haptic(40)
            }}
          />
        </div>
        <button
          onClick={startTourReplay}
          className="mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold border bg-white border-gray-200 text-polyblue"
        >
          <GraduationCap size={17} /> Ver el tutorial otra vez
        </button>
      </section>

      <button onClick={refresh} className="w-full text-center text-sm text-gray-400 py-2">
        Actualizar portafolio
      </button>
    </div>
  )
}
