import { CheckCircle, TrendingDown, TrendingUp, XCircle } from 'lucide-react'
import { cents, money, percentValue, shares as fmtShares, signedMoney } from '../lib/format'

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-gray-500 text-xs font-medium mb-1">{label}</div>
      <div className="font-bold text-gray-900 text-lg">{value}</div>
    </div>
  )
}

/** Tarjeta de una posición (abierta o cerrada). Espera el objeto de buildPosition(). */
export default function PositionCard({ position: p }) {
  const positive = p.pnl >= 0
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 shadow-sm ${p.closed ? 'opacity-95' : 'hover:shadow-md transition-shadow'}`}>
      <div className="mb-4">
        <h3 className={`font-bold leading-snug mb-2 ${p.closed ? 'text-gray-700' : 'text-gray-900'}`}>{p.question}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold ${
              p.side === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'
            }`}
          >
            {p.side} • {fmtShares(p.shares)} acciones
          </div>
          {p.closed &&
            (p.isWinner ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-green-100 text-green-700 border-2 border-green-300">
                <CheckCircle size={14} /> GANASTE
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold bg-gray-100 text-gray-600 border-2 border-gray-300">
                <XCircle size={14} /> PERDISTE
              </div>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {p.closed ? (
          <>
            <Stat label="Invertido" value={money(p.costBasis)} />
            <Stat label="Valor final" value={money(p.currentValue)} />
            <div>
              <div className="text-gray-500 text-xs font-medium mb-1">Resultado</div>
              <div className={`font-bold text-lg ${positive ? 'text-polygreen' : 'text-polyred'}`}>{signedMoney(p.pnl)}</div>
            </div>
          </>
        ) : (
          <>
            <Stat label="Costo prom." value={cents(p.avgCost)} />
            <Stat label="Precio actual" value={cents(p.currentPrice)} />
            <Stat label="Valor total" value={money(p.currentValue)} />
          </>
        )}
      </div>

      <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-600">{p.closed ? 'P/L realizado' : 'P/L no realizado'}</span>
        <div className={`flex items-center gap-2 font-bold text-lg ${positive ? 'text-polygreen' : 'text-polyred'}`}>
          {positive ? <TrendingUp size={20} strokeWidth={2.5} /> : <TrendingDown size={20} strokeWidth={2.5} />}
          <span>{signedMoney(p.pnl)}</span>
          <span className="text-sm font-semibold">({percentValue(p.pnlPercent)})</span>
        </div>
      </div>
    </div>
  )
}
