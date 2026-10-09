import { useCallback, useState } from 'react'
import { rpc } from '../../lib/api'
import { usePolling } from '../../hooks/usePolling'
import { dateTime, money } from '../../lib/format'

const ACTION_LABELS = {
  create_market: 'Creó un mercado',
  update_market: 'Editó un mercado',
  resolve_market: 'Resolvió un mercado',
  reopen_market: 'Deshizo una resolución',
  delete_market: 'Anuló un mercado',
  update_balance: 'Ajustó un saldo',
  archive_and_reset: 'Archivó y reinició la partida',
  approve_suggestion: 'Aprobó una sugerencia',
  reject_suggestion: 'Rechazó una sugerencia',
  moderator_on: 'Nombró moderador a',
  moderator_off: 'Quitó de moderador a',
  rename_player: 'Cambió el nombre de un jugador',
  reset_password: 'Restableció la contraseña de',
}

export default function ActivityTab() {
  const [actions, setActions] = useState(null)
  const load = useCallback(async () => {
    setActions((await rpc('admin_recent_actions', { p_limit: 60 })) || [])
  }, [])
  usePolling(load, { interval: 30000 })

  if (!actions) return <div className="skeleton h-40 rounded-2xl" />
  if (actions.length === 0) {
    return <p className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-200">Todavía no hay actividad registrada.</p>
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100">
      {actions.map((a) => {
        const d = a.detail || {}
        const subject = d.question || d.username || d.to || a.target_username
        return (
          <div key={a.id} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm leading-snug">
              <span className="font-bold text-gray-900">{a.admin_username || 'Alguien'}</span>{' '}
              <span className="text-gray-600">{(ACTION_LABELS[a.action] || a.action).toLowerCase()}</span>
              {subject && <span className="text-gray-500"> · {subject}</span>}
              {a.amount !== null && a.amount !== undefined && !['create_market', 'reject_suggestion', 'approve_suggestion'].includes(a.action) && (
                <span className="text-gray-500"> · {money(a.amount)}</span>
              )}
            </div>
            <span className="text-[11px] text-gray-400 flex-shrink-0 text-right">{dateTime(a.created_at)}</span>
          </div>
        )
      })}
    </div>
  )
}
