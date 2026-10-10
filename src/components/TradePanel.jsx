import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CalendarClock, ChevronDown, Lock, Loader2, RefreshCw, Trophy, Zap } from 'lucide-react'
import { db, rpc } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useConfirm } from './ConfirmDialog'
import { Countdown, OpensIn } from './Countdown'
import { closesLabel } from '../lib/time'
import {
  maxAvgPrice,
  minAvgPrice,
  newRequestId,
  parseAmount,
  quoteBuy,
  quoteSell,
  spotPrice,
} from '../lib/trading'
import { cents, friendlyError, money, shares as fmtShares, sideLabel } from '../lib/format'
import { fireBurst, haptic, HAPTIC, playSound } from '../lib/fx'
import { store } from '../lib/storage'

const BUY_PRESETS = [5, 10, 25, 50]
const SELL_PRESETS = [0.25, 0.5, 0.75]
const DEFAULT_TOLERANCE = 5 // %: cubre el movimiento normal cuando varios compran a la vez
const PRICE_CHANGED = /El precio cambió/

/**
 * Panel de operaciones (comprar / vender) de UN mercado. Lo usa la hoja de
 * operar que se abre desde cualquier pantalla, así la lógica vive en un solo lugar.
 */
export default function TradePanel({ marketId, initialSide = 'YES', initialMode = 'BUY', onDone }) {
  const { profile, applyBalance } = useAuth()
  const { config, daily, marketsById, applyTradeResult, refreshMarkets } = useGame()
  const confirm = useConfirm()
  const market = marketsById.get(marketId)

  const [side, setSide] = useState(initialSide)
  const [mode, setMode] = useState(initialMode)
  const [amount, setAmount] = useState('')
  const [tolerance, setTolerance] = useState(() => store.get('fm_tolerance', DEFAULT_TOLERANCE))
  const [advanced, setAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(null) // { previous } cuando el precio se movió mientras confirmabas
  const [shaking, setShaking] = useState(false)
  const [success, setSuccess] = useState(null)
  const [owned, setOwned] = useState({ YES: 0, NO: 0 })
  const [ownedFor, setOwnedFor] = useState(null)
  const pendingRef = useRef({ key: null, id: null })
  const loadingRef = useRef(false)
  const buttonRef = useRef(null)
  const doneTimer = useRef(null)
  const retryRef = useRef(null)

  const balance = profile?.balance ?? 0
  const remaining = daily?.remaining ?? null

  useEffect(() => () => clearTimeout(doneTimer.current), [])

  // Si el precio se movió, lleva la vista al aviso para que no quede tapado.
  useEffect(() => {
    if (retry) retryRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [retry])

  // Reinicia el formulario al cambiar de lado / modo.
  useEffect(() => {
    setAmount('')
    setError(null)
    setRetry(null)
  }, [side, mode])

  // Acciones propias (solo lectura; RLS limita a las del usuario).
  const loadOwned = useCallback(async () => {
    if (!profile?.id) return
    try {
      const rows = await db.myShares(marketId)
      const next = { YES: 0, NO: 0 }
      rows.forEach((row) => {
        next[row.side] = Number(row.count)
      })
      setOwned(next)
      setOwnedFor(marketId)
    } catch {
      /* se reintentará al volver a abrir */
    }
  }, [marketId, profile?.id])

  useEffect(() => {
    loadOwned()
  }, [loadOwned])

  const value = parseAmount(amount)
  const quote = useMemo(() => {
    if (!market || !(value > 0)) return null
    return mode === 'BUY' ? quoteBuy(market, side, value, config) : quoteSell(market, side, value, config)
  }, [value, mode, market, side, config])

  if (!market) {
    return <p className="text-center text-gray-500 py-8">Este mercado ya no está disponible.</p>
  }

  const open = market.state === 'open'
  const ownedSide = owned[side] || 0
  const ownedLoaded = ownedFor === marketId
  const hasAnyShares = owned.YES > 0 || owned.NO > 0
  const presetsReady = mode === 'BUY' || ownedLoaded
  const insufficient = quote && !quote.error && (mode === 'BUY' ? value > balance : value > ownedSide)
  const noMoves = remaining !== null && remaining <= 0
  const canSubmit = !!quote && !quote.error && !insufficient && !noMoves && !loading && open && !success
  const spot = spotPrice(market, side)

  const setPreset = (preset) => {
    if (mode === 'BUY') setAmount(String(Math.min(preset, Math.floor(balance * 100) / 100)))
    else setAmount(String(Math.floor(ownedSide * preset * 1e6) / 1e6))
  }
  const setMax = () =>
    setAmount(String(mode === 'BUY' ? Math.floor(balance * 100) / 100 : Math.floor(ownedSide * 1e6) / 1e6))

  const changeTolerance = (v) => {
    setTolerance(v)
    store.set('fm_tolerance', v)
  }

  const shake = () => {
    setShaking(false)
    requestAnimationFrame(() => setShaking(true))
  }

  const reject = (message) => {
    setError(message)
    shake()
    haptic(HAPTIC.reject)
    playSound('reject')
  }

  const execute = async ({ skipConfirm = false } = {}) => {
    if (!canSubmit || loadingRef.current) return

    const big = mode === 'BUY' && value >= Math.max(250, balance * 0.5)
    if (big && !skipConfirm) {
      const ok = await confirm({
        title: 'Es una compra grande',
        message: `Vas a invertir ${money(quote.investment)} de tus ${money(balance)} en "${market.question}" (${sideLabel(side)}).`,
        confirmText: 'Sí, comprar',
      })
      if (!ok) return
    }

    loadingRef.current = true
    setLoading(true)
    setError(null)
    setRetry(null)

    // Mismo request_id si reintentamos tras un fallo de red: el servidor nunca duplica la operación.
    const key = `${mode}|${side}|${marketId}|${value}`
    const requestId = pendingRef.current.key === key ? pendingRef.current.id : newRequestId()
    pendingRef.current = { key, id: requestId }

    try {
      const result =
        mode === 'BUY'
          ? await rpc(
              'buy_shares',
              {
                p_market_id: marketId,
                p_side: side,
                p_investment: quote.investment,
                p_max_price: maxAvgPrice(quote.avgPrice, tolerance),
                p_request_id: requestId,
              },
              { retries: 2 }
            )
          : await rpc(
              'sell_shares',
              {
                p_market_id: marketId,
                p_side: side,
                p_shares_to_sell: quote.shares,
                p_min_price: minAvgPrice(quote.avgPrice, tolerance),
                p_request_id: requestId,
              },
              { retries: 2 }
            )

      pendingRef.current = { key: null, id: null }
      applyBalance(result.new_balance)
      applyTradeResult(marketId, result)
      setOwned((prev) => ({
        ...prev,
        [side]: Math.max(0, (prev[side] || 0) + (mode === 'BUY' ? result.shares_bought : -result.shares_sold)),
      }))
      refreshMarkets()
      loadOwned()

      setSuccess({
        mode,
        side,
        shares: mode === 'BUY' ? result.shares_bought : result.shares_sold,
        price: result.price,
        payout: result.payout,
        investment: result.investment,
        remaining: result.daily_moves_remaining,
      })
      haptic(HAPTIC.success)
      playSound('success')
      const rect = buttonRef.current?.getBoundingClientRect()
      fireBurst(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight * 0.7 }, side)
      doneTimer.current = setTimeout(() => onDone?.(result), 1700)
    } catch (err) {
      const message = err?.message || ''
      // Si fue un fallo de red el resultado es incierto: conservamos el request_id para reintentar sin riesgo.
      if (!/Failed to fetch|NetworkError|Load failed/i.test(message)) {
        pendingRef.current = { key: null, id: null }
      }
      if (PRICE_CHANGED.test(message)) {
        // Otro jugador movió el precio justo antes: se trae el precio nuevo y se ofrece reintentar de un toque.
        setRetry({ previous: quote.avgPrice })
        shake()
        haptic(HAPTIC.reject)
        playSound('reject')
        refreshMarkets()
      } else {
        reject(friendlyError(err))
        refreshMarkets()
      }
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  const isYes = side === 'YES'
  const tone = isYes
    ? { solid: 'bg-polygreen', soft: 'bg-emerald-50 border-emerald-200', text: 'text-polygreen', ring: 'shadow-green-500/30' }
    : { solid: 'bg-polyred', soft: 'bg-rose-50 border-rose-200', text: 'text-polyred', ring: 'shadow-red-500/30' }
  const retrying = !!retry && !!quote && !quote.error
  const buttonClass = retrying
    ? 'bg-amber-500 shadow-amber-500/30'
    : mode === 'BUY'
    ? `${tone.solid} ${tone.ring}`
    : 'bg-gray-900 shadow-gray-500/30'

  // Mercado que ya no admite operaciones
  if (!open) {
    const pending = market.state === 'pending'
    const upcoming = market.state === 'upcoming'
    return (
      <div className="text-center py-8">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${upcoming ? 'bg-violet-50' : 'bg-amber-50'}`}>
          {upcoming ? <CalendarClock size={30} className="text-violet-600" /> : <Lock size={30} className="text-amber-600 animate-lock-snap" />}
        </div>
        <h3 className="font-bold text-lg text-gray-900 mb-1">{upcoming ? 'Todavía no abre' : pending ? 'Apuestas cerradas' : 'Mercado resuelto'}</h3>
        <p className="text-gray-500 text-sm">
          {upcoming
            ? `Se abre el ${closesLabel(market.opens_at)}. Vuelve entonces para apostar.`
            : pending
              ? 'Ya pasó la hora de cierre. Estamos esperando el resultado.'
              : `Resultado: ${sideLabel(market.outcome)}. Ya no se puede operar.`}
        </p>
        {upcoming && <OpensIn opensAt={market.opens_at} className="mt-3" />}
      </div>
    )
  }

  return (
    <div className={`relative space-y-4 ${shaking ? 'animate-shake' : ''}`} onAnimationEnd={(e) => e.target === e.currentTarget && setShaking(false)}>
      {market.closes_at && (
        <div className="flex justify-center -mt-1">
          <Countdown closesAt={market.closes_at} full />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {['YES', 'NO'].map((s) => {
          const active = side === s
          const yes = s === 'YES'
          return (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`py-3 rounded-2xl font-bold transition-all border-2 ${
                active
                  ? yes
                    ? 'bg-emerald-50 border-polygreen text-polygreen shadow-md shadow-green-500/15'
                    : 'bg-rose-50 border-polyred text-polyred shadow-md shadow-red-500/15'
                  : 'bg-white border-gray-200 text-gray-500'
              }`}
            >
              <div className="text-xs mb-0.5">{sideLabel(s)}</div>
              <div className="text-2xl tabular-nums">{cents(spotPrice(market, s))}</div>
            </button>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1">
        {[
          ['BUY', 'Comprar'],
          ['SELL', 'Vender'],
        ].map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={m === 'SELL' && ownedLoaded && !hasAnyShares}
            className={`py-2.5 rounded-lg font-semibold transition-all disabled:opacity-40 ${
              mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="trade-amount" className="text-sm font-semibold text-gray-700">
            {mode === 'BUY' ? 'Cuánto quieres invertir' : `Cuántas acciones «${sideLabel(side)}» vender`}
          </label>
          {remaining !== null && (
            <span className={`text-xs font-semibold flex items-center gap-1 ${remaining <= 5 ? 'text-red-600' : 'text-gray-500'}`}>
              <Zap size={12} /> {remaining} hoy
            </span>
          )}
        </div>
        <div className="relative">
          {mode === 'BUY' && (
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-2xl font-semibold pointer-events-none">$</span>
          )}
          <input
            id="trade-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value.replace(/[^0-9.,]/g, ''))
              if (retry) setRetry(null)
            }}
            placeholder="0.00"
            className={`w-full ${mode === 'BUY' ? 'pl-10' : 'pl-4'} pr-4 py-3.5 text-2xl font-bold rounded-2xl border-2 border-gray-200 focus:border-polyblue focus:ring-4 focus:ring-polyblue/10 outline-none transition tabular-nums`}
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {(mode === 'BUY' ? BUY_PRESETS : SELL_PRESETS).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              disabled={!presetsReady}
              className="px-3.5 py-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              {mode === 'BUY' ? `$${p}` : `${p * 100}%`}
            </button>
          ))}
          <button
            onClick={setMax}
            disabled={!presetsReady}
            className="px-3.5 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-sm font-bold text-polyblue disabled:opacity-50"
          >
            {mode === 'BUY' ? 'Máx' : 'Todo'}
          </button>
          <span className="ml-auto self-center text-xs text-gray-500">
            {mode === 'BUY'
              ? `Saldo ${money(balance)}`
              : ownedLoaded
              ? `Tienes ${fmtShares(ownedSide)} ${sideLabel(side)}`
              : 'Cargando tus acciones…'}
          </span>
        </div>
      </div>

      {retry && quote && !quote.error && (
        <div ref={retryRef} className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 animate-pop">
          <div className="flex items-start gap-3">
            <RefreshCw size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-amber-900">
              <p className="font-bold">Otro jugador movió el precio</p>
              <p className="mt-0.5">
                Pasó de <b>{cents(retry.previous, 1)}</b> a <b>{cents(quote.avgPrice, 1)}</b> por acción. Tu dinero no se
                tocó: toca el botón de abajo para comprar al precio nuevo.
              </p>
            </div>
          </div>
        </div>
      )}

      {quote && !quote.error && !insufficient && (
        <div className={`rounded-2xl border p-4 space-y-2 text-sm animate-fade-in ${tone.soft}`}>
          {mode === 'BUY' ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-gray-600 flex items-center gap-1.5">
                  <Trophy size={15} className="text-amber-500" /> Si gana «{sideLabel(side)}» recibes
                </span>
                <span className={`font-extrabold text-lg tabular-nums ${tone.text}`}>{money(quote.shares)}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Ganancia posible</span>
                <span className="font-semibold text-gray-700 tabular-nums">+{money(quote.shares - quote.investment)}</span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Recibes ahora</span>
              <span className="font-extrabold text-lg text-polygreen tabular-nums">{money(quote.payout)}</span>
            </div>
          )}
          <div className="pt-2 border-t border-black/5 space-y-1 text-xs text-gray-600">
            <Row label={mode === 'BUY' ? 'Acciones' : 'Vendes'} value={`${fmtShares(quote.shares)} ${sideLabel(side)}`} />
            <Row label="Precio promedio" value={cents(quote.avgPrice, 2)} />
            <Row label={`Comisión (${(config.fee_rate * 100).toFixed(0)}%)`} value={money(quote.fee)} />
            <Row
              label={`Nuevo precio «${sideLabel(side)}»`}
              value={`${cents(quote.finalPrice, 1)} (${quote.priceImpact > 0 ? '+' : ''}${quote.priceImpact.toFixed(1)}%)`}
            />
          </div>
        </div>
      )}

      {quote?.error && <Alert tone="warn" title="Revisa la cantidad" text={quote.error} />}
      {insufficient && (
        <Alert
          tone="warn"
          title={mode === 'BUY' ? 'Saldo insuficiente' : 'No tienes tantas acciones'}
          text={mode === 'BUY' ? `Tienes ${money(balance)}.` : `Tienes ${fmtShares(ownedSide)} ${sideLabel(side)}.`}
        />
      )}
      {error && <Alert tone="error" title="No se pudo completar" text={error} />}

      <div className="rounded-2xl bg-gray-50 border border-gray-200">
        <button
          onClick={() => setAdvanced(!advanced)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-600"
          aria-expanded={advanced}
        >
          <span>
            Tolerancia de precio: <b className="text-polyblue">{tolerance}%</b>
          </span>
          <ChevronDown size={18} className={`transition-transform ${advanced ? 'rotate-180' : ''}`} />
        </button>
        {advanced && (
          <div className="px-4 pb-4 animate-fade-in">
            <input
              type="range"
              min="0.5"
              max="20"
              step="0.5"
              value={tolerance}
              onChange={(e) => changeTolerance(parseFloat(e.target.value))}
              className="w-full accent-polyblue"
              style={{ touchAction: 'none' }}
              aria-label="Tolerancia de precio"
            />
            <p className="text-xs text-gray-500 mt-1.5">
              Si el precio se mueve más de {tolerance}% antes de ejecutar (porque otro jugador operó justo antes), la
              operación se cancela sin costo y puedes reintentarla de un toque.
            </p>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 bg-gradient-to-t from-white via-white to-white/80">
        <button
          ref={buttonRef}
          onClick={() => execute({ skipConfirm: retrying })}
          disabled={!canSubmit}
          className={`w-full py-4 rounded-2xl font-bold text-lg text-white transition-all disabled:opacity-45 disabled:shadow-none shadow-lg flex items-center justify-center gap-2 ${buttonClass}`}
        >
          {loading ? (
            <>
              <Loader2 size={20} className="animate-spin" /> Procesando…
            </>
          ) : noMoves ? (
            'Sin movimientos disponibles hoy'
          ) : retrying ? (
            `Reintentar a ${cents(quote.avgPrice, 1)}`
          ) : mode === 'BUY' ? (
            `Comprar ${sideLabel(side)}${quote && !quote.error ? ` · ${money(quote.investment)}` : ''}`
          ) : (
            `Vender ${sideLabel(side)}${quote && !quote.error ? ` · ${money(quote.payout)}` : ''}`
          )}
        </button>
      </div>

      {success && <SuccessOverlay success={success} onClose={() => onDone?.()} />}
    </div>
  )
}

function SuccessOverlay({ success, onClose }) {
  const buy = success.mode === 'BUY'
  const yes = success.side === 'YES'
  const color = buy ? (yes ? '#009E60' : '#E02D3C') : '#111827'
  return (
    <div
      className="absolute -inset-4 bg-white/95 backdrop-blur-sm rounded-3xl flex flex-col items-center justify-center text-center p-6 animate-fade-in z-10"
      role="status"
      onClick={onClose}
    >
      <div className="relative w-24 h-24 mb-5">
        <span className="absolute inset-0 rounded-full animate-pulse-ring-once" style={{ background: color, opacity: 0.35 }} />
        <span className="absolute inset-0 rounded-full animate-pulse-ring-once" style={{ background: color, opacity: 0.25, animationDelay: '0.18s' }} />
        <div className="absolute inset-0 rounded-full flex items-center justify-center animate-pop shadow-lg" style={{ background: color }}>
          <svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" className="check-path animate-draw-check" />
          </svg>
        </div>
      </div>
      <h3 className="text-2xl font-extrabold text-gray-900 animate-slide-up">{buy ? '¡Compra hecha!' : '¡Venta hecha!'}</h3>
      <p className="text-gray-600 mt-1 animate-slide-up" style={{ animationDelay: '0.08s' }}>
        {buy
          ? `${fmtShares(success.shares)} «${sideLabel(success.side)}» a ${cents(success.price, 1)} promedio`
          : `Recibiste ${money(success.payout)} por ${fmtShares(success.shares)} «${sideLabel(success.side)}»`}
      </p>
      <span
        className="mt-3 px-4 py-1.5 rounded-full text-white font-extrabold text-lg animate-float-up"
        style={{ background: color, animationDelay: '0.2s' }}
      >
        {buy ? `+${fmtShares(success.shares)} ${sideLabel(success.side)}` : `+${money(success.payout)}`}
      </span>
      {typeof success.remaining === 'number' && (
        <p className="text-xs text-gray-400 mt-4 flex items-center gap-1 font-semibold">
          <Zap size={12} /> Te quedan {success.remaining} movimientos hoy
        </p>
      )}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="font-semibold text-gray-800 tabular-nums">{value}</span>
    </div>
  )
}

function Alert({ tone, title, text }) {
  const styles = tone === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-yellow-50 border-yellow-300 text-yellow-900'
  return (
    <div className={`border-2 rounded-2xl p-4 flex items-start gap-3 animate-fade-in ${styles}`} role="alert">
      <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <p className="font-semibold mb-0.5">{title}</p>
        <p>{text}</p>
      </div>
    </div>
  )
}
