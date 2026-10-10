import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { fireSoftConfetti, fireWinConfetti, haptic, HAPTIC, playSound } from '../lib/fx'
import { money, sideLabel } from '../lib/format'
import AnimatedNumber from './ui/AnimatedNumber'

const titleOf = (p) => (p?.group_topic ? `${p.group_topic} — ${p.question}` : p?.question || 'Mercado')

/** Letras que entran una a una. */
function StaggerText({ text, className = '', delay = 0.35 }) {
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="inline-block animate-pop"
          style={{ animationDelay: `${delay + i * 0.045}s` }}
        >
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  )
}

function Sparkles() {
  const spots = [
    { top: '4%', left: '8%', d: '0s', s: 22 },
    { top: '10%', right: '6%', d: '0.4s', s: 18 },
    { top: '46%', left: '-2%', d: '0.8s', s: 16 },
    { top: '58%', right: '-1%', d: '0.2s', s: 20 },
    { bottom: '10%', left: '12%', d: '0.6s', s: 14 },
  ]
  return spots.map((p, i) => (
    <span
      key={i}
      aria-hidden="true"
      className="absolute animate-bounce-soft select-none"
      style={{ ...p, animationDelay: p.d, fontSize: p.s }}
    >
      ✨
    </span>
  ))
}

function Shell({ closing, children, tone = 'win' }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-5" role="dialog" aria-modal="true">
      <div
        className={`absolute inset-0 backdrop-blur-sm ${closing ? 'animate-fade-out' : 'animate-fade-in'} ${
          tone === 'win' ? 'bg-slate-900/70' : 'bg-slate-900/60'
        }`}
      />
      {tone === 'win' && (
        <div className="absolute w-[560px] h-[560px] max-w-[160vw] max-h-[160vw] rays animate-spin-slow pointer-events-none" aria-hidden="true" />
      )}
      <div className={`relative w-full max-w-sm ${closing ? 'animate-card-out' : 'animate-card-in'}`}>{children}</div>
    </div>
  )
}

function Counter({ index, total }) {
  if (total < 2) return null
  return (
    <span className="absolute top-4 right-5 text-xs font-bold text-gray-400">
      {index + 1} de {total}
    </span>
  )
}

function WinCard({ n, index, total, onClose, closing }) {
  const p = n.payload || {}
  const payout = Number(p.payout) || 0
  const profit = Number(p.profit) || 0
  const happy = profit >= 0

  useEffect(() => {
    let stop = () => {}
    if (happy) {
      fireWinConfetti().then((s) => {
        stop = s
      })
    }
    haptic(HAPTIC.win)
    playSound(happy ? 'win' : 'success')
    return () => stop()
  }, [happy])

  return (
    <Shell closing={closing}>
      <div className="relative bg-gradient-to-b from-white to-emerald-50 rounded-[28px] shadow-2xl px-6 pt-12 pb-6 text-center">
        <Counter index={index} total={total} />
        <Sparkles />
        <div className="absolute -top-11 left-1/2 -translate-x-1/2">
          <div className="relative">
            <span className="absolute inset-0 rounded-full bg-amber-300 animate-pulse-ring" />
            <div className="relative w-[88px] h-[88px] rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center text-5xl shadow-xl ring-4 ring-white animate-pop">
              <span className="animate-wiggle inline-block">{happy ? '🏆' : '✅'}</span>
            </div>
          </div>
        </div>

        <h2 className="text-[34px] leading-tight font-extrabold text-gray-900 mt-2">
          <StaggerText text={happy ? '¡Ganaste!' : 'Acertaste'} />
        </h2>
        <p className="text-sm text-gray-500 mt-2 leading-snug px-2 line-clamp-3">{titleOf(p)}</p>
        <p className="text-xs font-semibold text-gray-400 mt-1">
          Ganó «{sideLabel(p.outcome)}»
        </p>

        <div className="mt-5 rounded-2xl bg-white border border-emerald-100 shadow-inner py-4">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Cobras</p>
          <p className="text-[44px] leading-none font-black text-polygreen tabular-nums mt-1">
            <AnimatedNumber value={payout} from={0} duration={1500} delay={500} format={(v) => money(v)} />
          </p>
          <p
            className={`mt-2 text-sm font-bold animate-slide-up ${happy ? 'text-emerald-700' : 'text-gray-500'}`}
            style={{ animationDelay: '1.5s' }}
          >
            {happy
              ? `+${money(profit)} de ganancia`
              : `Tu apuesta acertó pero no cubrió lo invertido (${money(profit)})`}
          </p>
        </div>

        <button
          autoFocus
          onClick={onClose}
          className="mt-5 w-full py-4 rounded-2xl bg-polygreen hover:bg-green-700 text-white font-extrabold text-lg shadow-lg shadow-green-500/30 tap-feedback animate-slide-up"
          style={{ animationDelay: '0.9s' }}
        >
          {total > 1 && index < total - 1 ? 'Siguiente' : '¡A cobrar! 💰'}
        </button>
      </div>
    </Shell>
  )
}

function LossCard({ n, index, total, onClose, closing }) {
  const p = n.payload || {}
  const lost = Math.abs(Number(p.profit) || 0)

  useEffect(() => {
    haptic(HAPTIC.lose)
    playSound('lose')
  }, [])

  return (
    <Shell closing={closing} tone="lose">
      <div className="relative bg-white rounded-[28px] shadow-2xl px-6 pt-11 pb-6 text-center">
        <Counter index={index} total={total} />
        <div className="absolute -top-11 left-1/2 -translate-x-1/2">
          <div className="w-[84px] h-[84px] rounded-full bg-gradient-to-br from-slate-200 to-slate-400 flex items-center justify-center text-5xl shadow-xl ring-4 ring-white animate-pop">
            <span className="inline-block animate-wiggle">😔</span>
          </div>
        </div>
        <h2 className="text-3xl font-extrabold text-gray-900 mt-3 animate-slide-up">Esta vez no fue</h2>
        <p className="text-sm text-gray-500 mt-2 leading-snug px-2 line-clamp-3">{titleOf(p)}</p>
        <p className="text-xs font-semibold text-gray-400 mt-1">Ganó «{sideLabel(p.outcome)}»</p>

        <div className="mt-5 rounded-2xl bg-rose-50/70 border border-rose-100 py-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Perdiste</p>
          <p className="text-4xl leading-none font-black text-polyred tabular-nums mt-1">
            <AnimatedNumber value={lost} from={0} duration={900} delay={350} format={(v) => `-${money(v)}`} />
          </p>
          <p className="mt-2 text-sm text-gray-500">¡La revancha está en el próximo mercado!</p>
        </div>

        <button
          autoFocus
          onClick={onClose}
          className="mt-5 w-full py-4 rounded-2xl bg-gray-900 hover:bg-gray-800 text-white font-bold text-lg tap-feedback"
        >
          {total > 1 && index < total - 1 ? 'Siguiente' : 'Entendido'}
        </button>
      </div>
    </Shell>
  )
}

const INFO = {
  HIDDEN_REWARD: {
    emoji: '🎁',
    title: '¡Premio por mercado sorpresa!',
    text: (p) => `Hubo un mercado sorpresa en el que no pudiste participar. Como compensación recibiste ${money(p.amount)}.`,
    button: '¡Genial!',
  },
  MARKET_REOPENED: {
    emoji: '↩️',
    title: 'Resolución deshecha',
    text: (p) =>
      Number(p.reversed) > 0
        ? `Se corrigió el resultado de «${titleOf(p)}». Se revirtieron ${money(p.reversed)} que habías cobrado; el mercado vuelve a estar abierto.`
        : `Se corrigió el resultado de «${titleOf(p)}». El mercado vuelve a estar abierto.`,
    button: 'Entendido',
  },
  MARKET_CANCELLED: {
    emoji: '🧾',
    title: 'Mercado anulado',
    text: (p) => {
      const refunded = Number(p.refunded) || 0
      return refunded >= 0
        ? `Se anuló «${titleOf(p)}». Te devolvimos ${money(refunded)} y se borró su historial.`
        : `Se anuló «${titleOf(p)}». Se ajustó tu saldo en ${money(refunded)}.`
    },
    button: 'Entendido',
  },
  SUGGESTION_APPROVED: {
    emoji: '🎉',
    title: '¡Tu sugerencia fue aprobada!',
    text: (p) => `«${p.question}» ya está disponible para apostar.`,
    button: 'Ver el mercado',
  },
  SUGGESTION_REJECTED: {
    emoji: '📝',
    title: 'Sugerencia no aprobada',
    text: (p) => `«${p.question}» no se publicó${p.reason ? `. Motivo: ${p.reason}` : '.'} ¡Puedes sugerir otra!`,
    button: 'Entendido',
  },
}

function InfoCard({ n, index, total, onClose, onOpenMarket, closing }) {
  const info = INFO[n.kind]
  const p = n.payload || {}
  const approved = n.kind === 'SUGGESTION_APPROVED' || n.kind === 'HIDDEN_REWARD'

  useEffect(() => {
    if (approved) {
      fireSoftConfetti()
      haptic(HAPTIC.success)
      playSound('success')
    } else {
      haptic(HAPTIC.close)
    }
  }, [approved])

  return (
    <Shell closing={closing} tone="info">
      <div className="relative bg-white rounded-[28px] shadow-2xl px-6 pt-11 pb-6 text-center">
        <Counter index={index} total={total} />
        <div className="absolute -top-11 left-1/2 -translate-x-1/2">
          <div className="w-[84px] h-[84px] rounded-full bg-gradient-to-br from-blue-100 to-blue-300 flex items-center justify-center text-5xl shadow-xl ring-4 ring-white animate-pop">
            {info.emoji}
          </div>
        </div>
        <h2 className="text-2xl font-extrabold text-gray-900 mt-3 animate-slide-up">{info.title}</h2>
        <p className="text-sm text-gray-600 mt-3 leading-relaxed animate-slide-up" style={{ animationDelay: '0.1s' }}>
          {info.text(p)}
        </p>
        <button
          autoFocus
          onClick={n.kind === 'SUGGESTION_APPROVED' && n.market_id ? () => onOpenMarket(n.market_id) : onClose}
          className="mt-6 w-full py-4 rounded-2xl bg-polyblue hover:bg-blue-700 text-white font-bold text-lg tap-feedback shadow-lg shadow-blue-500/20"
        >
          {info.button}
        </button>
        {n.kind === 'SUGGESTION_APPROVED' && (
          <button onClick={onClose} className="mt-2 w-full py-2 text-sm font-semibold text-gray-400">
            Después
          </button>
        )}
      </div>
    </Shell>
  )
}

/** Muestra, de una en una, las celebraciones/avisos pendientes del jugador. */
export default function CelebrationHost() {
  const { celebrations, dismissCelebration } = useGame()
  const navigate = useNavigate()
  const [closing, setClosing] = useState(false)
  const [done, setDone] = useState(0) // cuántas ya se vieron en esta tanda ("2 de 3")
  const timer = useRef(null)
  const current = celebrations[0]

  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!current) setDone(0)
  }, [current])

  useEffect(() => {
    if (!current) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [current])

  const close = useCallback(
    (after) => {
      if (!current || closing) return
      setClosing(true)
      timer.current = setTimeout(() => {
        dismissCelebration(current.id)
        setDone((d) => d + 1)
        setClosing(false)
        after?.()
      }, 220)
    },
    [current, closing, dismissCelebration]
  )

  if (!current) return null
  const props = {
    n: current,
    index: done,
    total: done + celebrations.length,
    closing,
    onClose: () => close(),
    onOpenMarket: (id) => close(() => navigate(`/m/${id}`)),
  }
  return createPortal(
    current.kind === 'MARKET_WON' ? (
      <WinCard key={current.id} {...props} />
    ) : current.kind === 'MARKET_LOST' ? (
      <LossCard key={current.id} {...props} />
    ) : INFO[current.kind] ? (
      <InfoCard key={current.id} {...props} />
    ) : null,
    document.body
  )
}
