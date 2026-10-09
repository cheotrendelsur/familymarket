import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Info, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../supabaseClient'
import { rpc } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useConfirm } from './ConfirmDialog'
import {
  maxAvgPrice,
  minAvgPrice,
  newRequestId,
  parseAmount,
  quoteBuy,
  quoteSell,
  spotPrice,
} from '../lib/trading'
import { cents, friendlyError, money, shares as fmtShares } from '../lib/format'

const BUY_PRESETS = [10, 25, 50, 100]
const SELL_PRESETS = [0.25, 0.5, 0.75]

/**
 * Panel de operaciones (comprar / vender). Lo usan el modal de Home y la
 * pantalla Trade, así la lógica vive en un único lugar.
 *
 * Props:
 *  · market, side
 *  · onSideChange?  si se pasa, muestra el selector YES / NO
 *  · onDone?        se llama tras una operación exitosa
 */
export default function TradePanel({ market, side, onSideChange, onDone }) {
  const { profile, applyBalance } = useAuth()
  const { config, daily, applyTradeResult, refreshMarkets } = useGame()
  const confirm = useConfirm()

  const [mode, setMode] = useState('BUY')
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [owned, setOwned] = useState({ YES: 0, NO: 0 })
  const [ownedFor, setOwnedFor] = useState(null) // id del mercado cuyas acciones ya cargaron
  const pendingRef = useRef({ key: null, id: null })
  const loadingRef = useRef(false)

  const balance = profile?.balance ?? 0
  const marketId = market.id
  const closed = market.closed
  const remaining = daily?.remaining ?? null
  const spot = spotPrice(market, side)

  // Reinicia el formulario al cambiar de mercado / lado / modo.
  useEffect(() => {
    setAmount('')
    setError(null)
  }, [marketId, side, mode])

  // Acciones propias (solo lectura; RLS limita a las del usuario).
  const loadOwned = useCallback(async () => {
    if (!profile?.id) return
    const { data } = await supabase.from('shares').select('side, count').eq('market_id', marketId)
    const next = { YES: 0, NO: 0 }
    ;(data || []).forEach((row) => {
      next[row.side] = Number(row.count)
    })
    setOwned(next)
    setOwnedFor(marketId)
  }, [marketId, profile?.id])

  useEffect(() => {
    loadOwned()
  }, [loadOwned])

  const value = parseAmount(amount)
  const quote = useMemo(() => {
    if (!(value > 0)) return null
    return mode === 'BUY' ? quoteBuy(market, side, value, config) : quoteSell(market, side, value, config)
  }, [value, mode, market, side, config])

  const ownedSide = owned[side] || 0
  const ownedLoaded = ownedFor === marketId
  const presetsReady = mode === 'BUY' || ownedLoaded
  const insufficient = quote && !quote.error && (mode === 'BUY' ? value > balance : value > ownedSide)
  const noMoves = remaining !== null && remaining <= 0
  const canSubmit = !!quote && !quote.error && !insufficient && !noMoves && !loading && !closed

  const setPreset = (preset) => {
    if (mode === 'BUY') setAmount(String(Math.min(preset, balance)))
    else setAmount(String(Math.floor(ownedSide * preset * 1e6) / 1e6))
  }
  const setMax = () => setAmount(String(mode === 'BUY' ? balance : ownedSide))

  const execute = async () => {
    if (!canSubmit || loadingRef.current) return

    const details =
      mode === 'BUY'
        ? [
            ['Inviertes', money(quote.investment)],
            ['Recibes', `${fmtShares(quote.shares)} ${side}`],
            ['Precio promedio', cents(quote.avgPrice, 2)],
            [`Fee (${(config.fee_rate * 100).toFixed(0)}%)`, money(quote.fee)],
            [`Nuevo precio ${side}`, cents(quote.finalPrice, 2)],
          ]
        : [
            ['Vendes', `${fmtShares(quote.shares)} ${side}`],
            ['Recibes', money(quote.payout)],
            ['Precio promedio', cents(quote.avgPrice, 2)],
            [`Fee (${(config.fee_rate * 100).toFixed(0)}%)`, money(quote.fee)],
            [`Nuevo precio ${side}`, cents(quote.finalPrice, 2)],
          ]
    const ok = await confirm({
      title: mode === 'BUY' ? `Confirmar compra de ${side}` : `Confirmar venta de ${side}`,
      message: market.question,
      details,
      confirmText: mode === 'BUY' ? 'Comprar' : 'Vender',
    })
    if (!ok) return

    loadingRef.current = true
    setLoading(true)
    setError(null)

    // Mismo request_id si reintentamos tras un fallo de red: el servidor nunca duplica la operación.
    const key = `${mode}|${side}|${marketId}|${value}`
    const requestId = pendingRef.current.key === key ? pendingRef.current.id : newRequestId()
    pendingRef.current = { key, id: requestId }

    try {
      let result
      if (mode === 'BUY') {
        result = await rpc(
          'buy_shares',
          {
            p_market_id: marketId,
            p_side: side,
            p_investment: quote.investment,
            p_max_price: maxAvgPrice(quote.avgPrice, slippage),
            p_request_id: requestId,
          },
          { retries: 2 }
        )
      } else {
        result = await rpc(
          'sell_shares',
          {
            p_market_id: marketId,
            p_side: side,
            p_shares_to_sell: quote.shares,
            p_min_price: minAvgPrice(quote.avgPrice, slippage),
            p_request_id: requestId,
          },
          { retries: 2 }
        )
      }

      pendingRef.current = { key: null, id: null }
      applyBalance(result.new_balance)
      applyTradeResult(marketId, result)
      setOwned((prev) => ({
        ...prev,
        [side]: Math.max(0, (prev[side] || 0) + (mode === 'BUY' ? result.shares_bought : -result.shares_sold)),
      }))
      refreshMarkets()
      loadOwned()

      toast.success(
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-gray-900">{mode === 'BUY' ? '¡Compra exitosa!' : '¡Venta exitosa!'}</span>
          {mode === 'BUY' ? (
            <span className="text-sm text-gray-600">
              {fmtShares(result.shares_bought)} {side} a {cents(result.price, 2)} promedio
            </span>
          ) : (
            <span className="text-sm text-gray-600">
              Recibiste {money(result.payout)} por {fmtShares(result.shares_sold)} {side}
            </span>
          )}
          <span className="text-xs text-gray-500 flex items-center gap-1 font-semibold mt-1">
            <Zap size={12} /> {result.daily_moves_remaining} movimientos restantes hoy
          </span>
        </div>,
        { duration: 4500 }
      )
      setAmount('')
      onDone?.(result)
    } catch (err) {
      // Si fue un fallo de red el resultado es incierto: conservamos el request_id para reintentar sin riesgo.
      if (!/Failed to fetch|NetworkError|Load failed/i.test(err?.message || '')) {
        pendingRef.current = { key: null, id: null }
      }
      setError(friendlyError(err))
      refreshMarkets()
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }

  const sideColor = side === 'YES' ? 'text-polygreen' : 'text-polyred'
  const buyButtonColor =
    mode === 'BUY'
      ? side === 'YES'
        ? 'bg-polygreen hover:bg-green-700 shadow-green-500/30'
        : 'bg-polyred hover:bg-red-700 shadow-red-500/30'
      : 'bg-gray-900 hover:bg-gray-800 shadow-gray-500/30'

  return (
    <div className="space-y-5">
      {onSideChange && (
        <div className="grid grid-cols-2 gap-3">
          {['YES', 'NO'].map((s) => (
            <button
              key={s}
              onClick={() => onSideChange(s)}
              className={`py-3 rounded-xl font-bold transition-all border-2 ${
                side === s
                  ? s === 'YES'
                    ? 'bg-emerald-50 border-polygreen text-polygreen shadow-lg shadow-green-500/20'
                    : 'bg-rose-50 border-polyred text-polyred shadow-lg shadow-red-500/20'
                  : 'bg-white border-gray-200 text-gray-600'
              }`}
            >
              <div className="text-xs mb-0.5">{s}</div>
              <div className="text-2xl">{cents(spotPrice(market, s))}</div>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1">
        {[
          ['BUY', 'Comprar'],
          ['SELL', 'Vender'],
        ].map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`py-2.5 rounded-md font-semibold transition-all ${
              mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={`rounded-xl p-4 border-2 flex items-center justify-between ${
          side === 'YES' ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'
        }`}
      >
        <span className="text-sm font-medium text-gray-700">Precio actual {side}</span>
        <div className="text-right">
          <div className={`text-3xl font-bold ${sideColor}`}>{cents(spot)}</div>
          <div className="text-xs text-gray-600">{(spot * 100).toFixed(1)}% probabilidad</div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="trade-amount" className="text-sm font-semibold text-gray-700">
            {mode === 'BUY' ? 'Cantidad a invertir (USD)' : `Acciones ${side} a vender`}
          </label>
          {remaining !== null && (
            <span
              className={`text-xs font-semibold flex items-center gap-1 ${
                remaining <= 5 ? 'text-red-600' : 'text-gray-500'
              }`}
            >
              <Zap size={12} /> {remaining} movimientos hoy
            </span>
          )}
        </div>
        <div className="relative">
          {mode === 'BUY' && (
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 text-xl font-semibold pointer-events-none">
              $
            </span>
          )}
          <input
            id="trade-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
            placeholder="0.00"
            className={`w-full ${mode === 'BUY' ? 'pl-9' : 'pl-4'} pr-4 py-4 text-2xl font-semibold rounded-xl border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition`}
          />
        </div>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {(mode === 'BUY' ? BUY_PRESETS : SELL_PRESETS).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              disabled={!presetsReady}
              className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              {mode === 'BUY' ? `$${p}` : `${p * 100}%`}
            </button>
          ))}
          <button
            onClick={setMax}
            disabled={!presetsReady}
            className="px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-sm font-bold text-polyblue disabled:opacity-50"
          >
            Máx
          </button>
          <span className="ml-auto self-center text-xs text-gray-500">
            {mode === 'BUY'
              ? `Saldo ${money(balance)}`
              : ownedLoaded
              ? `Tienes ${fmtShares(ownedSide)} ${side}`
              : 'Cargando tus acciones…'}
          </span>
        </div>
      </div>

      {quote && !quote.error && !insufficient && (
        <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 text-sm space-y-2.5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-7 h-7 bg-polyblue rounded-lg flex items-center justify-center">
              <Info size={16} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="font-bold text-gray-900">Resumen de la orden</span>
          </div>
          <Row
            label="Recibirás"
            strong
            value={mode === 'BUY' ? `${fmtShares(quote.shares)} ${side}` : money(quote.payout)}
            valueClass={mode === 'SELL' ? 'text-green-600' : ''}
          />
          <Row label="Precio promedio" value={cents(quote.avgPrice, 2)} />
          <Row label={`Fee (${(config.fee_rate * 100).toFixed(0)}%)`} value={`-${money(quote.fee)}`} valueClass="text-red-600" />
          <div className="pt-2 border-t border-blue-200 space-y-1.5">
            <Row label={`Nuevo precio ${side}`} value={cents(quote.finalPrice, 2)} valueClass="text-polyblue" />
            <Row
              label="Impacto en el precio"
              small
              value={`${quote.priceImpact > 0 ? '+' : ''}${quote.priceImpact.toFixed(2)}%`}
              valueClass={Math.abs(quote.priceImpact) > 10 ? 'text-orange-600' : 'text-gray-700'}
            />
          </div>
        </div>
      )}

      {quote?.error && <Alert tone="warn" title="Advertencia" text={quote.error} />}
      {insufficient && (
        <Alert
          tone="warn"
          title={mode === 'BUY' ? 'Saldo insuficiente' : 'No tienes suficientes acciones'}
          text={mode === 'BUY' ? `Tienes ${money(balance)}.` : `Tienes ${fmtShares(ownedSide)} ${side}.`}
        />
      )}
      {error && <Alert tone="error" title="No se pudo completar" text={error} />}

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="slippage" className="text-sm font-semibold text-gray-700">
            Tolerancia de precio
          </label>
          <span className="text-sm font-bold text-polyblue">{slippage}%</span>
        </div>
        <input
          id="slippage"
          type="range"
          min="0.5"
          max="20"
          step="0.5"
          value={slippage}
          onChange={(e) => setSlippage(parseFloat(e.target.value))}
          className="w-full accent-polyblue"
          style={{ touchAction: 'none' }}
        />
        <p className="text-xs text-gray-600 mt-2">
          Si el precio cambia más de {slippage}% antes de ejecutar (por otra operación), se cancela sin costo.
        </p>
      </div>

      <button
        onClick={execute}
        disabled={!canSubmit}
        className={`w-full py-4 rounded-xl font-bold text-lg text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${buyButtonColor}`}
      >
        {loading
          ? 'Procesando...'
          : closed
          ? 'Mercado cerrado'
          : noMoves
          ? 'Sin movimientos disponibles hoy'
          : mode === 'BUY'
          ? `Comprar ${side}`
          : `Vender ${side}`}
      </button>
    </div>
  )
}

function Row({ label, value, strong = false, small = false, valueClass = '' }) {
  return (
    <div className="flex justify-between items-center gap-4">
      <span className={`${small ? 'text-xs' : ''} text-gray-700 ${strong ? 'font-medium' : ''}`}>{label}</span>
      <span className={`${strong ? 'font-bold text-base' : 'font-semibold'} ${small ? 'text-xs' : ''} text-gray-900 ${valueClass}`}>
        {value}
      </span>
    </div>
  )
}

function Alert({ tone, title, text }) {
  const styles =
    tone === 'error'
      ? 'bg-red-50 border-red-200 text-red-700'
      : 'bg-yellow-50 border-yellow-300 text-yellow-900'
  return (
    <div className={`border-2 rounded-xl p-4 flex items-start gap-3 ${styles}`}>
      <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-sm">
        <p className="font-semibold mb-0.5">{title}</p>
        <p>{text}</p>
      </div>
    </div>
  )
}
