import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Sheet from './ui/Sheet'
import TradePanel from './TradePanel'
import { useGame } from '../context/GameContext'

const TradeContext = createContext(null)

// eslint-disable-next-line react-refresh/only-export-components
export const useTrade = () => {
  const ctx = useContext(TradeContext)
  if (!ctx) throw new Error('useTrade debe usarse dentro de TradeProvider')
  return ctx
}

/** Hoja de operar única para toda la app: cualquier pantalla llama openTrade(id, 'YES' | 'NO', 'BUY' | 'SELL'). */
export function TradeProvider({ children }) {
  const { marketsById } = useGame()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(null)

  const openTrade = useCallback((marketId, side = 'YES', mode = 'BUY') => {
    setTarget({ marketId, side, mode, nonce: `${marketId}-${Date.now()}` })
    setOpen(true)
  }, [])
  const close = useCallback(() => setOpen(false), [])

  const market = target ? marketsById.get(target.marketId) : null
  const title = market ? (market.group_topic ? `${market.group_topic} — ${market.question}` : market.question) : ''

  const value = useMemo(() => ({ openTrade, closeTrade: close }), [openTrade, close])

  return (
    <TradeContext.Provider value={value}>
      {children}
      <Sheet open={open} onClose={close} title={title} subtitle="Operar" labelledBy="trade-title">
        {target && (
          <TradePanel
            key={target.nonce}
            marketId={target.marketId}
            initialSide={target.side}
            initialMode={target.mode}
            onDone={close}
          />
        )}
      </Sheet>
    </TradeContext.Provider>
  )
}
