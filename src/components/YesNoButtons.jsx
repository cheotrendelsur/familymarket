import { memo } from 'react'
import { noPrice, yesPrice } from '../lib/trading'
import { sideLabel } from '../lib/format'
import { HAPTIC, haptic } from '../lib/fx'
import PriceFlash from './ui/PriceFlash'

/**
 * Botones "Sí 62¢ / No 38¢". Tocarlos abre la hoja de operar (no navega).
 * `compact` los hace más bajos para las filas de los mercados múltiples.
 */
function YesNoButtons({ market, onPick, compact = false, disabled = false }) {
  const yes = Math.round(yesPrice(market) * 100)
  const no = Math.round(noPrice(market) * 100)
  const size = compact ? 'h-9 px-2.5 text-[13px] rounded-lg min-w-[64px]' : 'h-11 text-[15px] rounded-xl flex-1'

  const pick = (side) => (e) => {
    e.stopPropagation()
    haptic(HAPTIC.tap)
    onPick(market.id, side)
  }

  return (
    <div className={`flex gap-2 ${compact ? 'flex-shrink-0' : ''}`}>
      <button
        onClick={pick('YES')}
        disabled={disabled}
        aria-label={`Comprar Sí a ${yes} centavos`}
        className={`${size} font-bold flex items-center justify-center gap-1.5 bg-emerald-50 text-polygreen border border-emerald-200 hover:bg-emerald-100 active:bg-emerald-200 tap-feedback disabled:opacity-50`}
      >
        {sideLabel('YES')}
        <PriceFlash value={yes} className="tabular-nums px-0.5">
          {yes}¢
        </PriceFlash>
      </button>
      <button
        onClick={pick('NO')}
        disabled={disabled}
        aria-label={`Comprar No a ${no} centavos`}
        className={`${size} font-bold flex items-center justify-center gap-1.5 bg-rose-50 text-polyred border border-rose-200 hover:bg-rose-100 active:bg-rose-200 tap-feedback disabled:opacity-50`}
      >
        {sideLabel('NO')}
        <PriceFlash value={no} className="tabular-nums px-0.5">
          {no}¢
        </PriceFlash>
      </button>
    </div>
  )
}

export default memo(YesNoButtons)
