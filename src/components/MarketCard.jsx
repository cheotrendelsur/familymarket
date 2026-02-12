import { memo } from 'react'
import { TrendingUp } from 'lucide-react'

const MarketCard = memo(function MarketCard({ market, onClickYes, onClickNo }) {
  const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
  const yesPrice = parseFloat(market.yes_pool) / totalPool
  const noPrice = parseFloat(market.no_pool) / totalPool

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-polyblue" strokeWidth={2} />
          </div>
          <h3 className="font-semibold text-gray-900 leading-snug flex-1">
            {market.question}
          </h3>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          {/* YES Button */}
          <button
            onClick={() => onClickYes(market)}
            className="bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 rounded-xl p-4 border-2 border-emerald-200 transition-all tap-feedback no-select"
          >
            <div className="text-xs font-semibold text-gray-600 mb-1">YES</div>
            <div className="text-3xl font-bold text-polygreen mb-1">
              {(yesPrice * 100).toFixed(1)}¢
            </div>
            <div className="text-xs text-gray-600">
              {(yesPrice * 100).toFixed(0)}% prob.
            </div>
          </button>

          {/* NO Button */}
          <button
            onClick={() => onClickNo(market)}
            className="bg-rose-50 hover:bg-rose-100 active:bg-rose-200 rounded-xl p-4 border-2 border-rose-200 transition-all tap-feedback no-select"
          >
            <div className="text-xs font-semibold text-gray-600 mb-1">NO</div>
            <div className="text-3xl font-bold text-polyred mb-1">
              {(noPrice * 100).toFixed(1)}¢
            </div>
            <div className="text-xs text-gray-600">
              {(noPrice * 100).toFixed(0)}% prob.
            </div>
          </button>
        </div>

        {/* Pool Info */}
        <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-500 text-center">
          Pool Total: ${totalPool.toFixed(2)}
        </div>
      </div>
    </div>
  )
})

export default MarketCard