import { memo } from 'react'
import { TrendingUp } from 'lucide-react'
import { noPrice, yesPrice } from '../lib/trading'

const MarketCard = memo(function MarketCard({ market, onTrade }) {
  const yes = yesPrice(market)
  const no = noPrice(market)
  const liquidity = Number(market.yes_pool) + Number(market.no_pool)

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-polyblue" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 leading-snug">{market.question}</h3>
            {market.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{market.description}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onTrade(market, 'YES')}
            className="bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 rounded-xl p-4 border-2 border-emerald-200 transition-all tap-feedback no-select"
          >
            <div className="text-xs font-semibold text-gray-600 mb-1">YES</div>
            <div className="text-3xl font-bold text-polygreen mb-1">{(yes * 100).toFixed(1)}¢</div>
            <div className="text-xs text-gray-600">{(yes * 100).toFixed(0)}% prob.</div>
          </button>

          <button
            onClick={() => onTrade(market, 'NO')}
            className="bg-rose-50 hover:bg-rose-100 active:bg-rose-200 rounded-xl p-4 border-2 border-rose-200 transition-all tap-feedback no-select"
          >
            <div className="text-xs font-semibold text-gray-600 mb-1">NO</div>
            <div className="text-3xl font-bold text-polyred mb-1">{(no * 100).toFixed(1)}¢</div>
            <div className="text-xs text-gray-600">{(no * 100).toFixed(0)}% prob.</div>
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 text-center">
          Liquidez: {liquidity.toFixed(0)} tokens
        </div>
      </div>
    </div>
  )
})

export default MarketCard
