import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { rpc } from '../../lib/api'
import { serverNow } from '../../lib/clock'
import { friendlyError, money, sideLabel } from '../../lib/format'
import { haptic, HAPTIC } from '../../lib/fx'
import { useGame } from '../../context/GameContext'
import { useConfirm } from '../../components/ConfirmDialog'
import EditSheet from './EditSheet'

const titleOf = (m) => (m.group_topic ? `${m.group_topic} — ${m.question}` : m.question)

/**
 * Todas las acciones del staff sobre mercados (resolver, cerrar apuestas, anular, deshacer,
 * editar), en un solo lugar para usarlas igual desde el panel y desde la pantalla del mercado.
 * Devuelve las acciones y `editor` (el elemento de la hoja de edición, que hay que renderizar).
 */
export function useMarketActions() {
  const { refreshMarkets, refreshSession } = useGame()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(null)

  const after = useCallback(() => {
    refreshMarkets()
    refreshSession()
  }, [refreshMarkets, refreshSession])

  const resolve = useCallback(
    async (market, outcome) => {
      const ok = await confirm({
        title: `Resolver: gana «${sideLabel(outcome)}»`,
        message: `${titleOf(market)}\n\nPagará $1.00 por cada acción de «${sideLabel(outcome)}» y cerrará el mercado. Si te equivocas, el dueño puede deshacerlo.`,
        confirmText: `Gana ${sideLabel(outcome)}`,
        tone: 'danger',
      })
      if (!ok) return false
      try {
        const data = await rpc('resolve_market', { p_market_id: market.id, p_outcome: outcome })
        haptic(HAPTIC.success)
        toast.success(`Resuelto. Ganó «${sideLabel(outcome)}» · Pagado ${money(data.total_paid)} a ${data.winners} jugador(es)`, { duration: 6000 })
        after()
        return true
      } catch (err) {
        toast.error(friendlyError(err), { duration: 6000 })
        return false
      }
    },
    [confirm, after]
  )

  /** Mercado múltiple: se elige al ganador y las demás opciones pagan «No». `winner` null = nadie gana. */
  const resolveGroup = useCallback(
    async (list, winner) => {
      const topic = list[0].group_topic
      const ok = await confirm({
        title: winner ? `Gana «${winner.question}»` : 'Ninguna opción gana',
        message: `${topic}\n\n${
          winner
            ? `«${winner.question}» paga $1.00 por acción y las demás opciones pagan «No».`
            : 'Todas las opciones pagan «No».'
        }\nSi te equivocas, el dueño puede deshacerlo.`,
        confirmText: winner ? 'Confirmar ganador' : 'Resolver sin ganador',
        tone: 'danger',
      })
      if (!ok) return false
      let paid = 0
      let winners = 0
      let done = 0
      for (const m of list) {
        if (m.state === 'resolved') continue
        try {
          const data = await rpc('resolve_market', { p_market_id: m.id, p_outcome: winner && m.id === winner.id ? 'YES' : 'NO' })
          paid += Number(data.total_paid) || 0
          winners += Number(data.winners) || 0
          done += 1
        } catch (err) {
          if (/ya está cerrado/i.test(err?.message || '')) continue
          toast.error(`${friendlyError(err)} (se resolvieron ${done} de ${list.length}; vuelve a intentarlo)`, { duration: 7000 })
          after()
          return false
        }
      }
      haptic(HAPTIC.success)
      toast.success(`Resuelto · Pagado ${money(paid)} a ${winners} jugador(es)`, { duration: 6000 })
      after()
      return true
    },
    [confirm, after]
  )

  /** Cierra las apuestas ahora (un mercado, o todas las opciones de su grupo con `wholeGroup`). */
  const closeNow = useCallback(
    async (market, wholeGroup = false) => {
      const ok = await confirm({
        title: 'Cerrar las apuestas ahora',
        message: `Nadie podrá comprar ni vender en «${wholeGroup ? market.group_topic : market.question}». Quedará esperando el resultado.`,
        confirmText: 'Cerrar apuestas',
      })
      if (!ok) return false
      try {
        await rpc('staff_update_market', {
          p_market_id: market.id,
          p_patch: { closes_at: new Date(serverNow() - 2000).toISOString(), ...(market.state === 'upcoming' ? { opens_at: null } : {}) },
          p_apply_group: wholeGroup,
        })
        toast.success('Apuestas cerradas', { duration: 3500 })
        after()
        return true
      } catch (err) {
        toast.error(friendlyError(err), { duration: 6000 })
        return false
      }
    },
    [confirm, after]
  )

  /** Abre ya un mercado con apertura programada (un mercado, o todo su grupo). */
  const openNow = useCallback(
    async (market, wholeGroup = false) => {
      const ok = await confirm({
        title: 'Abrir ahora',
        message: `«${wholeGroup ? market.group_topic : market.question}» se abrirá en este momento y los jugadores ya podrán apostar.`,
        confirmText: 'Abrir ahora',
      })
      if (!ok) return false
      try {
        await rpc('staff_update_market', { p_market_id: market.id, p_patch: { opens_at: null }, p_apply_group: wholeGroup })
        toast.success('Mercado abierto', { duration: 3500 })
        after()
        return true
      } catch (err) {
        toast.error(friendlyError(err), { duration: 6000 })
        return false
      }
    },
    [confirm, after]
  )

  const annul = useCallback(
    async (market) => {
      const ok = await confirm({
        title: 'Anular y borrar mercado',
        message: `«${market.question}»\n\n• Devuelve a los jugadores el dinero invertido.\n• Revierte las ganancias de quienes vendieron antes.\n• Borra todo su historial.\n\nEs como si el mercado nunca hubiera existido. No se puede deshacer.`,
        confirmText: 'Anular mercado',
        tone: 'danger',
      })
      if (!ok) return false
      try {
        const data = await rpc('delete_market_and_refund', { p_market_id: market.id })
        toast.success(
          `Mercado anulado · ${data.users} jugador(es) ajustados${data.clamped_users ? ` (${data.clamped_users} sin saldo suficiente para devolver ganancias)` : ''}`,
          { duration: 6000 }
        )
        after()
        return true
      } catch (err) {
        toast.error(friendlyError(err), { duration: 6000 })
        return false
      }
    },
    [confirm, after]
  )

  const reopen = useCallback(
    async (market) => {
      const ok = await confirm({
        title: 'Deshacer la resolución',
        message: `«${market.question}»\n\nSe le quita el pago a quienes cobraron y el mercado vuelve a quedar abierto para que lo resuelvas bien. Cada jugador recibirá un aviso.`,
        confirmText: 'Deshacer resolución',
        tone: 'danger',
      })
      if (!ok) return false
      try {
        const data = await rpc('admin_reopen_market', { p_market_id: market.id })
        toast.success(`Resolución deshecha · ${money(data.reversed)} devueltos de ${data.users} jugador(es)`, { duration: 6000 })
        after()
        return true
      } catch (err) {
        toast.error(friendlyError(err), { duration: 6000 })
        return false
      }
    },
    [confirm, after]
  )

  const editor = editing ? <EditSheet market={editing} onClose={() => setEditing(null)} onSaved={after} /> : null

  return { resolve, resolveGroup, closeNow, openNow, annul, reopen, edit: setEditing, editor, after }
}
