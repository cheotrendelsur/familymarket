import { TrendingUp } from 'lucide-react'

export default function MarketCard({ market, onClickYes, onClickNo }) {
  const totalPool = parseFloat(market.yes_pool) + parseFloat(market.no_pool)
  const yesPrice = parseFloat(market.yes_pool) / totalPool
  const noPrice = parseFloat(market.no_pool) / totalPool

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4">
        {/* Header con ícono y pregunta */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <TrendingUp size={20} className="text-polyblue" strokeWidth={2} />
          </div>
          <h3 className="font-semibold text-gray-900 leading-snug flex-1">
            {market.question}
          </h3>
        </div>

        {/* Descripción (si existe) */}
        {market.description && (
          <p className="text-sm text-gray-600 mb-4 leading-relaxed">
            {market.description}
          </p>
        )}

        {/* Botones de Trading */}
        <div className="grid grid-cols-2 gap-3">
          {/* Botón YES */}
          <button
            onClick={() => onClickYes(market)}
            className="bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 transition-all rounded-xl p-4 text-left border border-emerald-200 group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Yes
              </span>
              <div className="w-2 h-2 bg-polygreen rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
            <div className="text-3xl font-bold text-polygreen mb-1">
              {(yesPrice * 100).toFixed(1)}¢
            </div>
            <div className="text-xs text-gray-500 font-medium">
              {(yesPrice * 100).toFixed(0)}% chance
            </div>
          </button>

          {/* Botón NO */}
          <button
            onClick={() => onClickNo(market)}
            className="bg-rose-50 hover:bg-rose-100 active:bg-rose-200 transition-all rounded-xl p-4 text-left border border-rose-200 group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                No
              </span>
              <div className="w-2 h-2 bg-polyred rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
            <div className="text-3xl font-bold text-polyred mb-1">
              {(noPrice * 100).toFixed(1)}¢
            </div>
            <div className="text-xs text-gray-500 font-medium">
              {(noPrice * 100).toFixed(0)}% chance
            </div>
          </button>
        </div>

        {/* Metadata (Total Pool) */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-500">Total Pool</span>
          <span className="text-xs font-semibold text-gray-700">
            ${totalPool.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  )
}