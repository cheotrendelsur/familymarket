import { cents, dateTime, money, shares as fmtShares, sideLabel } from '../lib/format'

const LABELS = {
  BUY: { text: 'Compra', badge: 'bg-blue-100 text-blue-700' },
  SELL: { text: 'Venta', badge: 'bg-gray-200 text-gray-700' },
  RESOLVE: { text: 'Pago', badge: 'bg-green-100 text-green-700' },
}

/**
 * Lista de operaciones. `ops`: [{ id?, at, question, type, side, shares, price, total }]
 * BUY: total = lo invertido · SELL/RESOLVE: total = lo recibido.
 */
export default function OperationsList({ ops, emptyText = 'Sin operaciones' }) {
  if (!ops || ops.length === 0) {
    return <div className="text-center py-8 bg-white rounded-2xl border border-gray-200 text-gray-500">{emptyText}</div>
  }
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100">
      {ops.map((op, i) => {
        const label = LABELS[op.type] || LABELS.BUY
        return (
          <div key={op.id || `${op.at}-${i}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 leading-snug">{op.question}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className={`text-[11px] font-bold rounded px-1.5 py-0.5 ${label.badge}`}>{label.text}</span>
                  <span
                    className={`text-[11px] font-bold rounded px-1.5 py-0.5 ${
                      op.side === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'
                    }`}
                  >
                    {sideLabel(op.side)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {fmtShares(op.shares)} acc. a {cents(op.price)}
                  </span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={`font-bold ${op.type === 'BUY' ? 'text-gray-900' : 'text-polygreen'}`}>
                  {op.type === 'BUY' ? '-' : '+'}
                  {money(op.total)}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">{dateTime(op.at)}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
