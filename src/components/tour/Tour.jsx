import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Loader2, Star, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { fireBurst, haptic, HAPTIC } from '../../lib/fx'
import {
  BuyScene,
  CloseScene,
  FinalScene,
  MoveScene,
  NavScene,
  OwnerScene,
  RankScene,
  ReadScene,
  RetryScene,
  StaffScene,
  WelcomeScene,
  buyCoach,
  closeCoach,
  finalCoach,
  moveCoach,
  navCoach,
  ownerCoach,
  rankCoach,
  readCoach,
  retryCoach,
  staffCoach,
  welcomeCoach,
} from './scenes'
import { useSandbox } from './sandbox'

function buildSteps({ isStaff, isOwner }) {
  return [
    { id: 'welcome', Scene: WelcomeScene, coach: welcomeCoach, cta: '¡Empezar!' },
    { id: 'read', Scene: ReadScene, coach: readCoach, task: true, hint: 'Toca el botón «Sí» de la tarjeta' },
    { id: 'buy', Scene: BuyScene, coach: buyCoach, task: true, hint: 'Elige $10 y toca «Comprar Sí»' },
    { id: 'move', Scene: MoveScene, coach: moveCoach, task: true, hint: 'Espera el movimiento y toca «Vender la mitad»' },
    { id: 'retry', Scene: RetryScene, coach: retryCoach, task: true, hint: 'Toca «Comprar Sí» y luego «Reintentar»' },
    { id: 'close', Scene: CloseScene, coach: closeCoach, task: true, hint: 'Adelanta el reloj y resuelve el mercado' },
    { id: 'rank', Scene: RankScene, coach: rankCoach, task: true, hint: 'Toca a un jugador del ranking' },
    { id: 'nav', Scene: NavScene, coach: navCoach, task: true, hint: 'Toca 3 pestañas de la barra de abajo' },
    ...(isStaff ? [{ id: 'staff', Scene: StaffScene, coach: staffCoach, task: true, hint: 'Publica la sugerencia y resuelve el mercado' }] : []),
    ...(isOwner ? [{ id: 'owner', Scene: OwnerScene, coach: ownerCoach, task: true, hint: 'Enciende el interruptor de Tomi' }] : []),
    { id: 'final', Scene: FinalScene, coach: finalCoach, cta: '¡Empezar a jugar!' },
  ]
}

function Backdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute -top-24 -left-20 w-72 h-72 rounded-full bg-fuchsia-400/30 blur-3xl animate-blob-float" />
      <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full bg-cyan-300/25 blur-3xl animate-blob-float" style={{ animationDelay: '-3s' }} />
      <div className="absolute -bottom-24 left-1/4 w-72 h-72 rounded-full bg-amber-300/25 blur-3xl animate-blob-float" style={{ animationDelay: '-6s' }} />
    </div>
  )
}

/**
 * Tutorial interactivo: misiones con práctica real (en un mercado de mentira) que obligan a
 * hacer cada operación. Se muestra una vez por jugador (mode "first") o a pedido (mode "replay").
 */
export default function Tour({ mode = 'first', onFinish, onSkip }) {
  const { isStaff, isOwner } = useAuth()
  const sb = useSandbox()
  const steps = useMemo(() => buildSteps({ isStaff, isOwner }), [isStaff, isOwner])
  const [index, setIndex] = useState(0)
  const [doneMap, setDoneMap] = useState({})
  const [stars, setStars] = useState(0)
  const [starKey, setStarKey] = useState(0)
  const [coach, setCoachState] = useState({ index: -1, node: null })
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const completedRef = useRef(new Set())

  const step = steps[index]
  const Scene = step.Scene
  const isLast = index === steps.length - 1
  const done = !step.task || !!doneMap[index]
  const coachNode = coach.index === index ? coach.node : step.coach
  const missions = steps.length - 2
  const label = index === 0 ? 'Bienvenida' : isLast ? '¡Meta!' : `Misión ${index} de ${missions}`
  const progress = Math.min(1, (index + (done ? 1 : 0.35)) / steps.length)

  useEffect(() => {
    if (mode !== 'replay') return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mode])

  const indexRef = useRef(0)
  indexRef.current = index
  const setCoach = useCallback((node) => setCoachState({ index: indexRef.current, node }), [])

  const complete = useCallback(() => {
    const i = indexRef.current
    if (completedRef.current.has(i)) return
    completedRef.current.add(i)
    setDoneMap((m) => ({ ...m, [i]: true }))
    setStars((s) => s + 1)
    setStarKey((k) => k + 1)
    haptic(HAPTIC.success)
    fireBurst({ x: window.innerWidth - 56, y: 40 }, 'YES')
  }, [])

  const next = async () => {
    if (!done || finishing) return
    if (isLast) {
      setFinishing(true)
      try {
        await onFinish?.()
      } finally {
        setFinishing(false)
      }
      return
    }
    haptic(HAPTIC.tap)
    setIndex((i) => i + 1)
  }

  const skip = () => {
    if (mode === 'replay') onSkip?.()
    else setConfirmSkip(true)
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-gradient-to-b from-blue-600 via-indigo-600 to-violet-700 text-white flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial de FamilyMarket"
    >
      <Backdrop />

      <header className="relative px-4 pb-2" style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}>
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-extrabold uppercase tracking-widest text-white/80" aria-live="polite">
              {label}
            </p>
            <div className="flex items-center gap-2">
              <span key={starKey} className="flex items-center gap-1 bg-white/15 rounded-full px-3 py-1 text-sm font-extrabold animate-pop" aria-label={`${stars} estrellas`}>
                <Star size={15} className="text-amber-300" fill="#FCD34D" /> {stars}
              </span>
              <button onClick={skip} className="text-xs font-bold text-white/70 hover:text-white px-2 py-1.5 rounded-lg" aria-label="Saltar el tutorial">
                {mode === 'replay' ? <X size={20} /> : 'Saltar'}
              </button>
            </div>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-white/20 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-yellow-400 transition-all duration-700 ease-out" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      </header>

      <main className="relative flex-1 overflow-y-auto scrollable-container px-4 pb-4">
        <div key={step.id} className="max-w-md mx-auto space-y-3 pt-2 animate-slide-up">
          <div className="flex items-end gap-3">
            <div className="w-16 h-16 flex-shrink-0 rounded-full bg-white flex items-center justify-center text-4xl shadow-xl animate-bounce-soft" aria-hidden="true">
              🦊
            </div>
            <div key={String(coach.index === index)} className="relative flex-1 bg-white text-gray-900 rounded-3xl rounded-bl-md px-4 py-3 shadow-xl text-[15px] leading-snug animate-bubble-in">
              {coachNode}
            </div>
          </div>
          <div className="bg-[#F9FAFB] text-gray-900 rounded-3xl p-3 shadow-2xl">
            <Scene sb={sb} complete={complete} done={done} setCoach={setCoach} stars={stars} />
          </div>
        </div>
      </main>

      <footer className="relative px-4 pt-3" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <div className="max-w-md mx-auto">
          {done ? (
            <button
              onClick={next}
              disabled={finishing}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 font-extrabold text-lg shadow-lg shadow-amber-900/30 animate-pop tap-feedback disabled:opacity-70"
            >
              {finishing && <Loader2 size={20} className="animate-spin" />}
              {step.cta || 'Siguiente'} {!finishing && !step.cta && <ArrowRight size={20} strokeWidth={3} />}
            </button>
          ) : (
            <button disabled className="w-full py-4 rounded-2xl bg-white/15 text-white/80 font-bold text-base" aria-live="polite">
              👆 {step.hint}
            </button>
          )}
        </div>
      </footer>

      {confirmSkip && (
        <div className="absolute inset-0 z-20 flex items-end sm:items-center justify-center p-4 bg-slate-900/60 animate-fade-in">
          <div className="w-full max-w-sm bg-white text-gray-900 rounded-3xl p-5 shadow-2xl animate-pop">
            <p className="text-lg font-extrabold">¿Saltar el tutorial?</p>
            <p className="text-sm text-gray-600 mt-1">Aprender a jugar toma solo 2 minutos. Si lo saltas, lo puedes volver a ver en <b>Portafolio → Preferencias</b>.</p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button onClick={() => setConfirmSkip(false)} className="py-3 rounded-xl bg-polyblue text-white font-bold">
                Seguir
              </button>
              <button onClick={() => onSkip?.()} className="py-3 rounded-xl bg-gray-100 text-gray-600 font-bold">
                Saltar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
