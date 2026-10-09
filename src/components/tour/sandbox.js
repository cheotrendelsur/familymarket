import { useCallback, useMemo, useReducer } from 'react'
import { DEFAULT_CONFIG, quoteBuy, quoteSell } from '../../lib/trading'

// Mercado de práctica: usa EXACTAMENTE la misma matemática que el juego real (lib/trading),
// pero vive solo en la memoria del tutorial. Nada de esto toca la base de datos.
// Pools elegidos para que «Sí» arranque en 40¢ (= 40 % de probabilidad).
const START = {
  balance: 1000,
  yes_pool: 1800,
  no_pool: 1200,
  shares: { YES: 0, NO: 0 },
  invested: 0,
  payout: 0,
  resolved: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'buy': {
      const { side, q } = action
      return {
        ...state,
        balance: state.balance - q.investment,
        yes_pool: q.newYesPool,
        no_pool: q.newNoPool,
        shares: { ...state.shares, [side]: state.shares[side] + q.shares },
        invested: state.invested + q.investment,
      }
    }
    case 'sell': {
      const { side, q } = action
      return {
        ...state,
        balance: state.balance + q.payout,
        yes_pool: q.newYesPool,
        no_pool: q.newNoPool,
        shares: { ...state.shares, [side]: Math.max(0, state.shares[side] - q.shares) },
      }
    }
    case 'other': {
      // Otro jugador compra: solo se mueven los precios.
      return { ...state, yes_pool: action.q.newYesPool, no_pool: action.q.newNoPool }
    }
    case 'resolve': {
      const payout = state.shares[action.outcome]
      return {
        ...state,
        balance: state.balance + payout,
        payout,
        resolved: action.outcome,
        shares: { YES: 0, NO: 0 },
      }
    }
    default:
      return state
  }
}

export function useSandbox() {
  const [state, dispatch] = useReducer(reducer, START)
  const market = useMemo(() => ({ id: 'tour', yes_pool: state.yes_pool, no_pool: state.no_pool }), [state.yes_pool, state.no_pool])

  const quote = useCallback((side, amount) => quoteBuy(market, side, amount, DEFAULT_CONFIG), [market])
  const quoteSellShares = useCallback((side, shares) => quoteSell(market, side, shares, DEFAULT_CONFIG), [market])

  const buy = useCallback(
    (side, amount) => {
      const q = quoteBuy(market, side, amount, DEFAULT_CONFIG)
      if (q.error) return q
      dispatch({ type: 'buy', side, q })
      return q
    },
    [market]
  )
  const sell = useCallback(
    (side, shares) => {
      const q = quoteSell(market, side, shares, DEFAULT_CONFIG)
      if (q.error) return q
      dispatch({ type: 'sell', side, q })
      return q
    },
    [market]
  )
  const other = useCallback(
    (side, amount) => {
      const q = quoteBuy(market, side, amount, DEFAULT_CONFIG)
      if (!q.error) dispatch({ type: 'other', q })
      return q
    },
    [market]
  )
  const resolve = useCallback((outcome) => dispatch({ type: 'resolve', outcome }), [])

  return { ...state, market, quote, quoteSellShares, buy, sell, other, resolve }
}
