import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Lock, ShieldCheck } from 'lucide-react'
import { cents, money, shares as fmtShares } from '../../lib/format'
import { fireSoftConfetti, fireWinConfetti, haptic, HAPTIC, playSound } from '../../lib/fx'
import { spotPrice } from '../../lib/trading'
import AnimatedNumber from '../ui/AnimatedNumber'
import { Avatar } from '../Leaderboard'
import Sheet from '../ui/Sheet'
import { MiniBottomNav, MiniNav, MiniMarketCard, MiniTicker, Target } from './Mini'

const B = ({ children }) => <b className="font-extrabold">{children}</b>

/* ------------------------------------------------------------------ 0. Bienvenida */
export const welcomeCoach = (
  <>
    ¡Hola! Soy <B>Fami</B> 🦊. Te voy a enseñar a jugar <B>jugando</B>: son 2 minutos y en cada misión harás algo de verdad.
  </>
)

export function WelcomeScene() {
  const coins = Array.from({ length: 14 }, (_, i) => ({ left: `${(i * 37) % 100}%`, delay: `${(i * 0.37) % 3.2}s`, size: 16 + ((i * 7) % 14) }))
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-amber-50 to-white py-9 text-center">
      {coins.map((c, i) => (
        <span key={i} className="absolute -top-6 animate-coin-fall select-none" style={{ left: c.left, animationDelay: c.delay, fontSize: c.size }} aria-hidden="true">
          🪙
        </span>
      ))}
      <p className="text-xs font-extrabold uppercase tracking-widest text-gray-400">Tu dinero de práctica</p>
      <p className="text-[52px] leading-tight font-black text-polygreen tabular-nums mt-1">
        <AnimatedNumber value={1000} from={0} duration={1600} delay={300} format={(v) => money(v, 0)} />
      </p>
      <p className="text-sm text-gray-500 px-6 mt-1">dólares <b>de mentira</b> para apostar con tu familia a lo que va a pasar</p>
    </div>
  )
}

/* ------------------------------------------------------------------ 1. Leer el mercado */
export const readCoach = (
  <>
    Cada mercado es una <B>pregunta</B> sobre algo que va a pasar. El precio de <B>Sí</B> es la <B>probabilidad</B>: si Sí cuesta 40¢, hay un 40 % de que pase.
  </>
)

export function ReadScene({ sb, complete, done, setCoach }) {
  const [picked, setPicked] = useState(false)
  const pick = () => {
    if (picked) return
    setPicked(true)
    haptic(HAPTIC.tap)
    setCoach(
      <>
        ¡Eso! <B>40¢ = 40 %</B>. Y «No» cuesta 60¢: los dos precios siempre suman <B>$1</B>. Si crees que es más probable que llueva, «Sí» está barato.
      </>
    )
    complete()
  }
  return (
    <div className="space-y-3">
      <MiniNav sb={sb} />
      <MiniMarketCard sb={sb} onYes={pick} onNo={pick} targetYes={!picked} />
      {done && (
        <div className="grid grid-cols-2 gap-2 animate-slide-up">
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-center">
            <p className="text-2xl font-black text-polygreen">40¢</p>
            <p className="text-xs font-semibold text-gray-600">Sí = 40 % de probabilidad</p>
          </div>
          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-3 text-center">
            <p className="text-2xl font-black text-polyred">60¢</p>
            <p className="text-xs font-semibold text-gray-600">No = 60 % de probabilidad</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 2. Comprar */
export const buyCoach = (
  <>
    Vamos a comprar <B>Sí</B>. Elige cuánto invertir: con <B>$10</B> es perfecto para practicar.
  </>
)

function SuccessBurst({ title, line, color = '#009E60' }) {
  return (
    <div className="absolute inset-0 z-10 bg-white/95 rounded-3xl flex flex-col items-center justify-center text-center p-4 animate-fade-in" role="status">
      <div className="relative w-20 h-20 mb-3">
        <span className="absolute inset-0 rounded-full animate-pulse-ring-once" style={{ background: color, opacity: 0.35 }} />
        <div className="absolute inset-0 rounded-full flex items-center justify-center animate-pop shadow-lg" style={{ background: color }}>
          <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" className="check-path animate-draw-check" />
          </svg>
        </div>
      </div>
      <h4 className="text-xl font-extrabold text-gray-900 animate-slide-up">{title}</h4>
      <p className="text-sm text-gray-600 mt-0.5">{line}</p>
    </div>
  )
}

export function BuyScene({ sb, complete, done, setCoach }) {
  const [amount, setAmount] = useState(null)
  const [flash, setFlash] = useState(null)
  const [result, setResult] = useState(null)
  const q = amount ? sb.quote('YES', amount) : null
  const yes = spotPrice(sb.market, 'YES')

  const choose = (v) => {
    if (result) return
    setAmount(v)
    haptic(HAPTIC.tap)
    setCoach(
      <>
        Mira el recuadro verde: si gana «Sí», cada acción paga <B>$1</B>. Ahora toca <B>Comprar Sí</B>.
      </>
    )
  }
  const buy = () => {
    if (!q || q.error || result) return
    const bought = sb.buy('YES', amount)
    if (bought.error) return
    haptic(HAPTIC.success)
    playSound('success')
    setResult(bought)
    setFlash({ title: '¡Compra hecha!', line: `${fmtShares(bought.shares)} acciones de «Sí»` })
    setTimeout(() => setFlash(null), 1500)
    setCoach(
      <>
        ¡Listo! Pagaste <B>{money(bought.investment)}</B> y ahora tienes <B>{fmtShares(bought.shares)} acciones</B>. Si llueve, te pagan <B>$1 por cada una</B>: {money(bought.shares)}.
      </>
    )
    complete()
  }

  return (
    <div className="space-y-3">
      <MiniNav sb={sb} />
      <div className="relative bg-white rounded-3xl border border-gray-200 shadow-card p-4 space-y-3">
        {flash && <SuccessBurst title={flash.title} line={flash.line} />}
        <p className="font-bold text-gray-900 leading-snug">¿Lloverá mañana en Margarita?</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border-2 border-polygreen bg-emerald-50 text-polygreen text-center py-2.5">
            <p className="text-xs font-bold">Sí</p>
            <p className="text-xl font-black tabular-nums">{cents(yes)}</p>
          </div>
          <div className="rounded-2xl border-2 border-gray-200 text-gray-400 text-center py-2.5">
            <p className="text-xs font-bold">No</p>
            <p className="text-xl font-black tabular-nums">{cents(1 - yes)}</p>
          </div>
        </div>
        <p className="text-sm font-semibold text-gray-700">Cuánto quieres invertir</p>
        <div className="flex gap-2">
          {[5, 10, 25].map((v) => (
            <Target key={v} active={!amount && v === 10 && !result} rounded="rounded-full" className="flex-1">
              <button
                onClick={() => choose(v)}
                aria-pressed={amount === v}
                className={`w-full py-2.5 rounded-full text-sm font-bold border ${amount === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-100 text-gray-700 border-transparent'}`}
              >
                ${v}
              </button>
            </Target>
          ))}
        </div>
        {q && !q.error && (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-sm animate-fade-in">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">🏆 Si gana «Sí» recibes</span>
              <span className="font-extrabold text-lg text-polygreen tabular-nums">{money(q.shares)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Ganancia posible <b>+{money(q.shares - q.investment)}</b> · comisión 2 % ({money(q.fee)})
            </p>
          </div>
        )}
        <Target active={!!q && !result} className="w-full">
          <button
            onClick={buy}
            disabled={!q || !!result}
            className="w-full py-3.5 rounded-2xl bg-polygreen text-white font-bold text-base shadow-lg shadow-green-500/30 disabled:opacity-45 disabled:shadow-none"
          >
            {q ? `Comprar Sí · ${money(q.investment)}` : 'Comprar Sí'}
          </button>
        </Target>
      </div>
      {done && result && (
        <div className="rounded-2xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 animate-slide-up">
          💡 Tus acciones aparecen en <b>Portafolio</b>, con cuánto ganas o pierdes en cada una.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 3. El precio se mueve y vender */
export const moveCoach = (
  <>
    Ahora mira: los demás también compran, y eso <B>mueve el precio</B>. Cuando compran Sí, Sí sube…
  </>
)

export function MoveScene({ sb, complete, done, setCoach }) {
  const [phase, setPhase] = useState('wait') // wait | moved | sold
  const [sold, setSold] = useState(null)
  const fired = useRef(false)
  const yes = spotPrice(sb.market, 'YES')
  const value = sb.shares.YES * yes

  useEffect(() => {
    const t1 = setTimeout(() => {
      if (fired.current) return
      fired.current = true
      sb.other('YES', 160)
      haptic(HAPTIC.tap)
      setPhase('moved')
      setCoach(
        <>
          ¡Mari compró «Sí» y el precio subió! Tus acciones ahora valen <B>más</B> de lo que pagaste. Puedes <B>vender</B> cuando quieras: el dinero vuelve a tu saldo (con 2 % de comisión). Vende la mitad.
        </>
      )
    }, 900)
    return () => clearTimeout(t1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sellHalf = () => {
    if (phase !== 'moved') return
    const half = Math.floor((sb.shares.YES / 2) * 1e6) / 1e6
    const q = sb.sell('YES', half)
    if (q.error) return
    haptic(HAPTIC.success)
    playSound('success')
    setSold(q)
    setPhase('sold')
    setCoach(
      <>
        Recibiste <B>{money(q.payout)}</B> por vender la mitad. Lo que no vendes sigue jugando: si gana «Sí», cobras $1 por acción.
      </>
    )
    complete()
  }

  return (
    <div className="space-y-3">
      <MiniNav sb={sb} />
      <MiniTicker>{phase === 'wait' ? 'Esperando movimientos…' : <><b>Mari</b> compró <b className="text-polygreen">Sí</b> · $160</>}</MiniTicker>
      <MiniMarketCard sb={sb} onYes={() => {}} onNo={() => {}} closed />
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-2">Tu posición</p>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm font-bold text-gray-900 tabular-nums">{fmtShares(sb.shares.YES)} acciones de «Sí»</p>
            <p className="text-xs text-gray-500">Pagaste {money(sb.invested)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Valen ahora</p>
            <p className="text-xl font-black text-polygreen tabular-nums">
              <AnimatedNumber value={value} flash format={(v) => money(v)} />
            </p>
          </div>
        </div>
        <Target active={phase === 'moved'} className="mt-3 w-full">
          <button
            onClick={sellHalf}
            disabled={phase !== 'moved'}
            className="w-full py-3.5 rounded-xl bg-gray-900 text-white font-bold disabled:opacity-40"
          >
            Vender la mitad
          </button>
        </Target>
      </div>
      {done && sold && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 animate-slide-up">
          ✅ Vendiste {fmtShares(sold.shares)} acciones y recibiste <b>{money(sold.payout)}</b>.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 4. Reintentar */
export const retryCoach = (
  <>
    A veces dos personas compran <B>justo al mismo tiempo</B>. Si el precio cambia antes de que se ejecute tu compra, <B>no se cobra nada</B>. Pruébalo: compra $10 más.
  </>
)

export function RetryScene({ sb, complete, done, setCoach }) {
  const [phase, setPhase] = useState('ready') // ready | rejected | bought
  const [previous, setPrevious] = useState(null)
  const [shake, setShake] = useState(false)
  const q = sb.quote('YES', 10)
  const avg = q.error ? 0 : q.avgPrice

  const tapBuy = () => {
    if (phase === 'ready') {
      setPrevious(avg)
      sb.other('YES', 170) // «otro jugador» compró un instante antes
      setPhase('rejected')
      setShake(true)
      setTimeout(() => setShake(false), 600)
      haptic(HAPTIC.reject)
      playSound('reject')
      setCoach(
        <>
          ¿Viste? Otro jugador movió el precio justo antes. <B>Tu dinero está intacto</B>. Toca <B>Reintentar</B> y compras al precio nuevo.
        </>
      )
      return
    }
    if (phase === 'rejected') {
      const bought = sb.buy('YES', 10)
      if (bought.error) return
      haptic(HAPTIC.success)
      playSound('success')
      setPhase('bought')
      setCoach(
        <>
          ¡Perfecto! Compraste <B>{fmtShares(bought.shares)} acciones</B> al precio nuevo. Si te pasa en el juego real, solo toca el botón amarillo.
        </>
      )
      complete()
    }
  }

  return (
    <div className="space-y-3">
      <MiniNav sb={sb} />
      <div className={`bg-white rounded-3xl border border-gray-200 shadow-card p-4 space-y-3 ${shake ? 'animate-shake' : ''}`}>
        <p className="font-bold text-gray-900 leading-snug">¿Lloverá mañana en Margarita?</p>
        <div className="rounded-2xl border-2 border-polygreen bg-emerald-50 text-polygreen text-center py-2.5">
          <p className="text-xs font-bold">Sí ahora cuesta</p>
          <p className="text-2xl font-black tabular-nums">{cents(spotPrice(sb.market, 'YES'))}</p>
        </div>
        {phase === 'rejected' && (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 animate-pop">
            <p className="font-bold">🔄 Otro jugador movió el precio</p>
            <p className="mt-0.5">
              Pasó de <b>{cents(previous, 1)}</b> a <b>{cents(avg, 1)}</b> por acción. Tu dinero no se tocó.
            </p>
          </div>
        )}
        {phase === 'bought' ? (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-center text-polygreen font-bold animate-pop">✅ ¡Compra hecha a {cents(avg, 1)}!</div>
        ) : (
          <Target active className="w-full">
            <button
              onClick={tapBuy}
              className={`w-full py-3.5 rounded-2xl text-white font-bold text-base shadow-lg ${phase === 'rejected' ? 'bg-amber-500 shadow-amber-500/30' : 'bg-polygreen shadow-green-500/30'}`}
            >
              {phase === 'rejected' ? `Reintentar a ${cents(avg, 1)}` : 'Comprar Sí · $10.00'}
            </button>
          </Target>
        )}
      </div>
      {done && (
        <div className="rounded-2xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 animate-slide-up">
          💡 En la hoja de operar, «Tolerancia de precio» (5 %) decide cuánto puede moverse el precio antes de pedirte reintentar.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 5. Cierre y resultado */
export const closeCoach = (
  <>
    Los mercados pueden tener <B>hora de cierre</B>: al llegar, nadie compra ni vende más. Vamos a pasar el reloj rápido.
  </>
)

const pad = (n) => String(n).padStart(2, '0')

function WinOverlay({ payout, onClose }) {
  useEffect(() => {
    let stop = () => {}
    fireWinConfetti().then((s) => {
      stop = s
    })
    haptic(HAPTIC.win)
    playSound('win')
    return () => stop()
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-label="Ganaste">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm animate-fade-in" />
      <div className="absolute w-[520px] h-[520px] max-w-[150vw] max-h-[150vw] rays animate-spin-slow pointer-events-none" aria-hidden="true" />
      <div className="relative w-full max-w-sm animate-card-in">
        <div className="relative bg-gradient-to-b from-white to-emerald-50 rounded-[28px] shadow-2xl px-6 pt-12 pb-6 text-center">
          <div className="absolute -top-11 left-1/2 -translate-x-1/2 w-[88px] h-[88px] rounded-full bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center text-5xl shadow-xl ring-4 ring-white animate-pop">
            <span className="animate-wiggle inline-block">🏆</span>
          </div>
          <h2 className="text-[34px] leading-tight font-extrabold text-gray-900 mt-2">¡Ganaste!</h2>
          <p className="text-sm text-gray-500 mt-1">Ganó «Sí» y cada acción pagó $1</p>
          <div className="mt-4 rounded-2xl bg-white border border-emerald-100 py-4">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Cobras</p>
            <p className="text-[42px] leading-none font-black text-polygreen tabular-nums mt-1">
              <AnimatedNumber value={payout} from={0} duration={1500} delay={400} format={(v) => money(v)} />
            </p>
          </div>
          <button onClick={onClose} className="mt-5 w-full py-4 rounded-2xl bg-polygreen text-white font-extrabold text-lg shadow-lg shadow-green-500/30 tap-feedback">
            ¡A cobrar! 💰
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function CloseScene({ sb, complete, done, setCoach }) {
  const [phase, setPhase] = useState('open') // open | running | closed | resolved
  const [left, setLeft] = useState(20)
  const [win, setWin] = useState(false)
  const payoutRef = useRef(0)

  const leftRef = useRef(20)
  useEffect(() => {
    if (phase !== 'running') return undefined
    const id = setInterval(() => {
      leftRef.current -= 1
      setLeft(Math.max(leftRef.current, 0))
      if (leftRef.current <= 0) {
        clearInterval(id)
        setPhase('closed')
        haptic(HAPTIC.close)
        playSound('close')
        setCoach(
          <>
            ¡Cerró! Ahora el mercado queda <B>esperando el resultado</B>. Un moderador confirma qué pasó. Esta vez <B>tú eres el moderador</B>: ¡sí llovió!
          </>
        )
      }
    }, 110)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const start = () => {
    if (phase !== 'open') return
    setPhase('running')
    haptic(HAPTIC.tap)
  }
  const resolve = () => {
    if (phase !== 'closed') return
    payoutRef.current = sb.shares.YES
    sb.resolve('YES')
    setPhase('resolved')
    setWin(true)
  }
  const closeWin = () => {
    setWin(false)
    setCoach(
      <>
        ¡Así se cobra! Las acciones ganadoras pagan <B>$1</B> y las perdedoras $0. Tu saldo ya subió. En el juego real, te llega este mismo aviso con confeti 🎉.
      </>
    )
    complete()
  }

  const urgent = left <= 10
  const critical = left <= 5
  const pillTone = phase === 'closed' || phase === 'resolved' ? 'bg-amber-50 border-amber-200 text-amber-700' : critical ? 'bg-red-50 border-red-200 text-red-600' : urgent ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-gray-50 border-gray-200 text-gray-600'

  return (
    <div className="space-y-3 relative">
      <MiniNav sb={sb} />
      {(phase === 'closed' || phase === 'resolved') && (
        <div className="flex items-center gap-3 bg-gray-900 text-white rounded-2xl px-4 py-3 shadow-lift animate-card-in">
          <span className="w-9 h-9 rounded-full bg-amber-400 text-gray-900 flex items-center justify-center"><Lock size={17} className="animate-lock-snap" /></span>
          <div>
            <p className="font-extrabold leading-tight">¡Apuestas cerradas!</p>
            <p className="text-xs text-gray-300">Ahora solo falta el resultado</p>
          </div>
        </div>
      )}
      <MiniMarketCard
        sb={sb}
        onYes={() => {}}
        onNo={() => {}}
        closed={phase === 'closed' || phase === 'resolved'}
        footer={
          <span className={`inline-flex items-center gap-1 border rounded-full px-2 py-0.5 font-bold tabular-nums ${pillTone}`} aria-label="Cuenta regresiva">
            {phase === 'closed' || phase === 'resolved' ? '🔒 Cerrado' : `⏱ 0:${pad(left)}`}
          </span>
        }
      />
      {(phase === 'open' || phase === 'running') && (
        <Target active={phase === 'open'} className="w-full">
          <button onClick={start} disabled={phase !== 'open'} className="w-full py-3.5 rounded-2xl bg-gray-900 text-white font-bold disabled:opacity-50">
            ⏩ Adelantar el reloj
          </button>
        </Target>
      )}
      {phase === 'closed' && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-polyblue/40 p-4 space-y-3 animate-slide-up">
          <p className="text-xs font-extrabold text-polyblue uppercase tracking-wider flex items-center gap-1.5"><ShieldCheck size={14} /> Panel del moderador (práctica)</p>
          <div className="grid grid-cols-2 gap-2">
            <Target className="w-full">
              <button onClick={resolve} className="w-full py-3.5 rounded-xl bg-polygreen text-white font-bold flex items-center justify-center gap-1.5">
                <CheckCircle2 size={18} /> Gana Sí
              </button>
            </Target>
            <button disabled className="py-3.5 rounded-xl bg-polyred text-white font-bold opacity-40">Gana No</button>
          </div>
        </div>
      )}
      {win && <WinOverlay payout={payoutRef.current} onClose={closeWin} />}
    </div>
  )
}

/* ------------------------------------------------------------------ 6. Ranking */
export const rankCoach = (
  <>
    Así se ve el <B>ranking</B>. Gana quien tenga más <B>patrimonio</B>: tu efectivo + lo que valen tus acciones. Toca a un jugador para ver cómo juega.
  </>
)

const STATS = {
  Yudrexi: { rate: 71, wins: 5, losses: 2, streak: '3 ganadas', best: '¿Ganó Venezuela el amistoso?' },
  Carluchooo: { rate: 58, wins: 7, losses: 5, streak: '1 ganada', best: '¿Se acabó la empanada?' },
  Plemecho: { rate: 50, wins: 3, losses: 3, streak: '2 perdidas', best: '¿Lloverá el sábado?' },
}

export function RankScene({ sb, complete, setCoach }) {
  const [open, setOpen] = useState(null)
  const rows = [
    { name: 'Yudrexi', worth: 1184 },
    { name: 'Carluchooo', worth: 1119 },
    { name: 'Plemecho', worth: 1043 },
    { name: 'Tú', worth: sb.balance, me: true },
    { name: 'Ricky', worth: 951 },
  ]
    .sort((a, b) => b.worth - a.worth)
    .map((r, i) => ({ ...r, rank: i + 1 }))
  const stat = open && STATS[open.name]

  const pick = (row) => {
    if (row.me) return
    setOpen(row)
    haptic(HAPTIC.tap)
    setCoach(
      <>
        Cada jugador tiene su <B>perfil</B>: aciertos, rachas y su mejor jugada. También hay una gráfica con la <B>carrera de patrimonio</B> de todos. ¡Que gane el mejor!
      </>
    )
    complete()
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden divide-y divide-gray-100">
        {rows.map((r, i) => (
          <div key={r.name} className={r.me ? 'bg-blue-50/70' : ''}>
            <Target active={i === 0 && !open} rounded="rounded-none" hand={i === 0}>
              <button onClick={() => pick(r)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                <span className="w-5 text-center font-extrabold text-gray-400">{r.rank}</span>
                <Avatar name={r.name === 'Tú' ? 'Cheche' : r.name} size={36} />
                <span className="flex-1 min-w-0 font-bold truncate text-gray-900">
                  {r.name} {r.me && <span className="text-[10px] font-bold uppercase bg-polyblue text-white rounded px-1.5 py-0.5 align-middle">Tú</span>}
                </span>
                <span className="font-extrabold tabular-nums">{money(r.worth)}</span>
              </button>
            </Target>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400 mb-2">Carrera de patrimonio</p>
        <svg viewBox="0 0 300 90" className="w-full" aria-hidden="true">
          {[
            ['#2563EB', 'M0,70 C40,60 70,64 100,48 S170,40 200,30 S260,18 300,12'],
            ['#009E60', 'M0,70 C50,66 90,72 130,58 S190,50 230,44 S270,36 300,34'],
            ['#E02D3C', 'M0,70 C40,72 80,60 120,62 S200,66 240,52 S280,56 300,50'],
          ].map(([c, d], i) => (
            <path key={c} d={d} fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset="1" style={{ animation: `draw-line 1.6s ${i * 0.25}s ease-out forwards` }} />
          ))}
        </svg>
        <style>{'@keyframes draw-line { to { stroke-dashoffset: 0 } }'}</style>
      </div>
      <Sheet open={!!open} onClose={() => setOpen(null)} z="z-[110]">
        {open && stat && (
          <div className="pb-2">
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={open.name} size={60} ring />
              <div>
                <h3 className="text-xl font-extrabold text-gray-900">{open.name}</h3>
                <p className="text-sm text-gray-500">Puesto #{open.rank} · {money(open.worth)}</p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-2xl p-4 mb-3">
              <div className="flex justify-between mb-2 text-sm"><span className="font-semibold text-gray-500">🎯 Aciertos</span><b>{stat.rate}%</b></div>
              <div className="h-2.5 rounded-full bg-rose-100 overflow-hidden"><div className="h-full rounded-full bg-polygreen transition-all duration-700" style={{ width: `${stat.rate}%` }} /></div>
              <p className="text-xs text-gray-500 mt-2">{stat.wins} ganadas · {stat.losses} perdidas</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-gray-50 rounded-2xl p-3"><p className="text-xs text-gray-400 font-semibold">Racha actual</p><b>{stat.streak}</b></div>
              <div className="bg-emerald-50 rounded-2xl p-3"><p className="text-xs text-emerald-700 font-semibold">Mejor jugada</p><b className="text-xs">{stat.best}</b></div>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}

/* ------------------------------------------------------------------ 7. Moverse por la app */
export const navCoach = (
  <>
    Esta es la <B>barra de abajo</B>, así te mueves por la app. Toca <B>3 pestañas</B> para ver qué hay en cada una.
  </>
)

const PANELS = {
  home: ['🏠 Inicio', 'Todos los mercados. Busca, filtra por categoría y toca Sí o No para operar. La cinta «EN VIVO» muestra lo que hacen los demás.'],
  rank: ['🏆 Ranking', 'Quién va ganando, sus perfiles y la carrera de patrimonio.'],
  port: ['💼 Portafolio', 'Tus acciones, cuánto ganas o pierdes, tu historial… y aquí activas el sonido y la vibración.'],
  sug: ['💡 Sugerir', '¿Se te ocurrió un mercado? Escríbelo aquí: el dueño y los moderadores lo publican si les gusta.'],
  mem: ['📖 Recuerdos', 'Las partidas anteriores, con su ranking y todas sus jugadas.'],
}

export function NavScene({ sb, complete, done, setCoach }) {
  const [active, setActive] = useState(null)
  const [visited, setVisited] = useState(() => new Set())
  const seen = useRef(new Set())

  const tab = (id) => {
    setActive(id)
    haptic(HAPTIC.tap)
    if (seen.current.has(id)) return
    seen.current.add(id)
    setVisited(new Set(seen.current))
    if (seen.current.size >= 3 && !done) {
      setCoach(
        <>
          ¡Ya le agarraste la onda! El número <B>⚡</B> de arriba son tus <B>movimientos de hoy</B>: tienes <B>60</B> y se renuevan cada día a medianoche (hora de Venezuela).
        </>
      )
      complete()
    }
  }
  const panel = active ? PANELS[active] : null

  return (
    <div className="space-y-3">
      <MiniNav sb={sb} />
      <div className="min-h-[150px] bg-white rounded-2xl border border-gray-200 shadow-card p-4 flex flex-col justify-center">
        {panel ? (
          <div key={active} className="animate-slide-up">
            <p className="font-extrabold text-gray-900 text-lg">{panel[0]}</p>
            <p className="text-sm text-gray-600 mt-1 leading-snug">{panel[1]}</p>
          </div>
        ) : (
          <p className="text-center text-gray-400 font-semibold">Toca una pestaña de abajo 👇</p>
        )}
      </div>
      <p className="text-center text-xs font-bold text-gray-500">Explorado: {Math.min(visited.size, 3)}/3 pestañas</p>
      <MiniBottomNav active={active} visited={visited} onTab={tab} />
    </div>
  )
}

/* ------------------------------------------------------------------ 8. Moderador */
export const staffCoach = (
  <>
    ¡Tienes <B>superpoderes</B>! En <B>Admin → Hoy</B> aparece solo lo pendiente. Prueba: publica la sugerencia y resuelve el mercado que ya cerró.
  </>
)

export function StaffScene({ complete, setCoach }) {
  const [published, setPublished] = useState(false)
  const [resolved, setResolved] = useState(false)

  const check = (p, r) => {
    if (p && r) {
      setCoach(
        <>
          ¡Eso es todo! Para <B>crear</B> un mercado usa la pestaña <B>Crear</B> (o el botón <B>+ Crear</B> en Inicio). Y dentro de cualquier mercado verás el recuadro «<B>Solo tú ves esto</B>» para resolverlo ahí mismo.
        </>
      )
      complete()
    }
  }
  const publish = () => {
    setPublished(true)
    haptic(HAPTIC.success)
    fireSoftConfetti()
    check(true, resolved)
  }
  const resolve = () => {
    setResolved(true)
    haptic(HAPTIC.success)
    playSound('success')
    check(published, true)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className={`rounded-2xl p-3 border ${resolved ? 'bg-white border-gray-200 text-gray-400' : 'bg-amber-50 border-amber-200 text-amber-800'}`}><p className="text-2xl font-black leading-none">{resolved ? 0 : 1}</p><p className="text-[11px] font-bold mt-1">Por resolver</p></div>
        <div className={`rounded-2xl p-3 border ${published ? 'bg-white border-gray-200 text-gray-400' : 'bg-blue-50 border-blue-200 text-polyblue'}`}><p className="text-2xl font-black leading-none">{published ? 0 : 1}</p><p className="text-[11px] font-bold mt-1">Sugerencias</p></div>
        <div className="rounded-2xl p-3 border bg-white border-gray-200 text-gray-700"><p className="text-2xl font-black leading-none">6</p><p className="text-[11px] font-bold mt-1">Abiertos</p></div>
      </div>
      {!resolved ? (
        <div className="bg-white rounded-2xl border-2 border-amber-200 p-4 shadow-card">
          <p className="font-bold text-gray-900">¿Salimos antes de las 9 am hacia la isla?</p>
          <p className="text-xs font-semibold text-amber-700 mt-0.5">Las apuestas cerraron hace 10 min</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Target className="w-full"><button onClick={resolve} className="w-full py-3 rounded-xl bg-polygreen text-white font-bold">✓ Gana Sí</button></Target>
            <button disabled className="py-3 rounded-xl bg-polyred text-white font-bold opacity-40">✗ Gana No</button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-center font-bold text-polygreen animate-pop">✅ Mercado resuelto: se pagó a los ganadores</div>
      )}
      {!published ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-card">
          <p className="text-xs text-gray-400 font-semibold">Ricky sugirió</p>
          <p className="font-semibold text-gray-900">¿Se acaba el hielo antes de las 4 pm?</p>
          <div className="grid grid-cols-[auto_1fr] gap-2 mt-3">
            <button disabled className="px-4 py-3 rounded-xl bg-rose-50 text-polyred font-bold opacity-50">No</button>
            <Target className="w-full"><button onClick={publish} className="w-full py-3 rounded-xl bg-polygreen text-white font-bold">✓ Publicar</button></Target>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-blue-50 border border-blue-200 p-3 text-center font-bold text-polyblue animate-pop">🎉 ¡Publicado! Ricky recibe un aviso</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 9. Dueño: moderadores */
export const ownerCoach = (
  <>
    Y como <B>dueño</B> tú decides quién ayuda. Para nombrar a un <B>moderador</B>: <B>Admin → Gente</B> y enciende el interruptor junto a su nombre. Pruébalo con Tomi.
  </>
)

export function OwnerScene({ complete, setCoach }) {
  const [on, setOn] = useState({})
  const people = [
    ['Tomi', 'Tomas_christiansen'],
    ['Mari', 'MariChris'],
    ['Ricky', 'Ricky'],
  ]
  const toggle = (id, name) => {
    const next = !on[id]
    setOn((m) => ({ ...m, [id]: next }))
    haptic(HAPTIC.tap)
    if (next) {
      setCoach(
        <>
          ¡Listo! <B>{name}</B> ya es moderador: puede crear y resolver mercados y revisar sugerencias. Para quitarlo, apaga el interruptor. Anular mercados, deshacer resoluciones, saldos y contraseñas siguen siendo solo tuyos.
        </>
      )
      complete()
    }
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100 overflow-hidden">
      {people.map(([id, name], i) => (
        <div key={id} className="flex items-center gap-3 px-4 py-3">
          <Avatar name={name} size={38} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-500">{on[id] ? 'Moderador' : 'Jugador'}</p>
          </div>
          <Target active={i === 0 && !on[id]} rounded="rounded-full" hand={i === 0}>
            <button
              onClick={() => toggle(id, name)}
              aria-pressed={!!on[id]}
              aria-label={`Hacer moderador a ${id}`}
              className={`w-12 h-7 flex items-center rounded-full p-0.5 transition-colors ${on[id] ? 'bg-polyblue' : 'bg-gray-300'}`}
            >
              <span className={`bg-white w-6 h-6 rounded-full shadow transition-transform ${on[id] ? 'translate-x-5' : ''}`} />
            </button>
          </Target>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ 10. Final */
export const finalCoach = (
  <>
    ¡Lo lograste! Ya sabes jugar. Estas son las <B>reglas de oro</B> para acordarte de todo:
  </>
)

export function FinalScene({ stars }) {
  const rules = [
    ['🪙', 'Juegas con dinero de mentira: empiezas con $1,000.'],
    ['🎯', 'El precio de «Sí» es la probabilidad de que pase.'],
    ['💵', 'Cada acción ganadora paga $1 al resolverse.'],
    ['⚡', 'Tienes 60 movimientos al día (comprar o vender).'],
    ['🔄', 'Si el precio cambió, toca «Reintentar».'],
    ['💡', 'Sugiere mercados desde la pestaña Sugerir.'],
  ]
  useEffect(() => {
    fireSoftConfetti()
    haptic(HAPTIC.win)
    playSound('win')
  }, [])
  return (
    <div className="space-y-3">
      <div className="text-center">
        <div className="text-6xl animate-bounce-soft inline-block" aria-hidden="true">🏆</div>
        <p className="font-extrabold text-gray-900 mt-1">¡Tutorial completado!</p>
        <p className="text-sm font-bold text-amber-600">⭐ {stars} estrellas ganadas</p>
      </div>
      <ul className="space-y-2">
        {rules.map(([emoji, text], i) => (
          <li key={text} className="flex items-center gap-3 bg-white rounded-2xl border border-gray-200 px-3.5 py-3 shadow-sm animate-slide-up" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
            <span className="text-2xl" aria-hidden="true">{emoji}</span>
            <span className="text-sm font-semibold text-gray-800 leading-snug">{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
