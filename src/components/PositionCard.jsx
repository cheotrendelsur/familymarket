import { Link } from 'react-router-dom'
import { CheckCircle, Lock, TrendingDown, TrendingUp, XCircle } from 'lucide-react'
import { cents, money, percentValue, shares as fmtShares, sideLabel, signedMoney } from '../lib/format'

function Stat({ label, value }) {
  return (
    <div>
      <div className="text-gray-400 text-xs font-medium mb-0.5">{label}</div>
      <div className="font-bold text-gray-900 tabular-nums">{value}</div>
    </div>
  )
}

/** Tarjeta de una posición (abierta o cerrada). Espera el objeto de buildPosition(). */
export default function PositionCard({ position: p, linkTo }) {
  const positive = p.pnl >= 0
  const body = (
    <div className={`bg-white rounded-2xl border border-gray-200 p-4 shadow-card ${p.closed ? 'opacity-95' : 'hover:shadow-lift transition-shadow'}`}>
      <div className="mb-3">
        <h3 className={`font-bold leading-snug mb-2 ${p.closed ? 'text-gray-700' : 'text-gray-900'}`}>{p.question}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${
              p.side === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'
            }`}
          >
            {sideLabel(p.side)} • {fmtShares(p.shares)} acciones
          </div>
          {p.closed ? (
            p.isWinner ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold bg-green-100 text-green-700">
                <CheckCircle size={14} /> GANASTE
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold bg-gray-100 text-gray-600">
                <XCircle size={14} /> PERDISTE
              </div>
            )
          ) : (
            p.pending && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold bg-amber-50 text-amber-700">
                <Lock size={13} /> Esperando resultado
              </div>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        {p.closed ? (
          <>
            <Stat label="Invertido" value={money(p.costBasis)} />
            <Stat label="Valor final" value={money(p.currentValue)} />
            <div>
              <div className="text-gray-400 text-xs font-medium mb-0.5">Resultado</div>
              <div className={`font-bold tabular-nums ${positive ? 'text-polygreen' : 'text-polyred'}`}>{signedMoney(p.pnl)}</div>
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

      <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{p.closed ? 'Resultado' : 'Ganancia / pérdida'}</span>
        <div className={`flex items-center gap-1.5 font-bold ${positive ? 'text-polygreen' : 'text-polyred'}`}>
          {positive ? <TrendingUp size={18} strokeWidth={2.5} /> : <TrendingDown size={18} strokeWidth={2.5} />}
          <span className="tabular-nums">{signedMoney(p.pnl)}</span>
          <span className="text-sm font-semibold">({percentValue(p.pnlPercent)})</span>
        </div>
      </div>
    </div>
  )
  return linkTo ? <Link to={linkTo} className="block tap-feedback">{body}</Link> : body
}
