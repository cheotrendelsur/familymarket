import { CheckCircle, Lock, Pencil, RotateCcw, ShieldCheck, Trophy, XCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { sideLabel } from '../lib/format'
import { useManage } from '../hooks/useManage'
import { useMarketActions } from '../pages/admin/useMarketActions'

/**
 * Atajos para el dueño y los moderadores sobre el mercado que están viendo
 * (solo ellos lo ven): resolver, cerrar apuestas o editar sin pasar por el panel.
 *  · market: mercado suelto   · group: lista de opciones de un mercado múltiple
 */
export default function StaffBar({ market = null, group = null }) {
  const { isStaff, isOwner } = useAuth()
  const { canManage } = useManage()
  const actions = useMarketActions()
  if (!isStaff) return null

  const list = group || [market]
  const first = list[0]
  // Un moderador solo ve los atajos en los mercados que él creó.
  if (!canManage(first)) return null
  const unresolved = list.filter((m) => m.state !== 'resolved')
  const allResolved = unresolved.length === 0
  const anyOpen = list.some((m) => m.state === 'open')
  const anyUpcoming = list.some((m) => m.state === 'upcoming')

  return (
    <section className="rounded-2xl border-2 border-dashed border-polyblue/40 bg-blue-50/50 p-4 space-y-3" aria-label="Atajos de administración">
      <p className="text-xs font-extrabold text-polyblue uppercase tracking-wider flex items-center gap-1.5">
        <ShieldCheck size={14} /> Solo tú ves esto
      </p>

      {anyUpcoming && (
        <button onClick={() => actions.openNow(first, !!group)} className="w-full flex items-center justify-center gap-2 bg-violet-600 text-white py-3.5 rounded-xl font-bold shadow-md shadow-violet-500/20 tap-feedback">
          Abrir ya
        </button>
      )}

      {!allResolved && !group && !anyUpcoming && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => actions.resolve(market, 'YES')} className="flex items-center justify-center gap-1.5 bg-polygreen text-white py-3.5 rounded-xl font-bold shadow-md shadow-green-500/20 tap-feedback">
            <CheckCircle size={19} strokeWidth={2.5} /> Gana {sideLabel('YES')}
          </button>
          <button onClick={() => actions.resolve(market, 'NO')} className="flex items-center justify-center gap-1.5 bg-polyred text-white py-3.5 rounded-xl font-bold shadow-md shadow-red-500/20 tap-feedback">
            <XCircle size={19} strokeWidth={2.5} /> Gana {sideLabel('NO')}
          </button>
        </div>
      )}

      {!allResolved && group && !anyUpcoming && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-gray-700">¿Quién ganó?</p>
          <div className="grid gap-2">
            {unresolved.map((m) => (
              <button
                key={m.id}
                onClick={() => actions.resolveGroup(list, m)}
                className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 font-bold text-gray-900 tap-feedback"
              >
                <span className="truncate">{m.question}</span>
                <span className="text-polygreen text-sm flex items-center gap-1 flex-shrink-0">
                  <Trophy size={15} /> Gana
                </span>
              </button>
            ))}
            <button onClick={() => actions.resolveGroup(list, null)} className="py-2.5 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-500">
              Ninguna gana
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => actions.edit(first)} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-700 tap-feedback">
          <Pencil size={15} /> Editar
        </button>
        {anyOpen && (
          <button onClick={() => actions.closeNow(first, !!group)} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-sm font-bold text-amber-800 tap-feedback">
            <Lock size={15} /> Cerrar apuestas
          </button>
        )}
        {isOwner && allResolved && !group && (
          <button onClick={() => actions.reopen(market)} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-700 tap-feedback">
            <RotateCcw size={15} /> Deshacer resolución
          </button>
        )}
      </div>
      {actions.editor}
    </section>
  )
}
