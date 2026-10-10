import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * Qué puede hacer con un mercado quien está usando la app (el servidor lo exige igual: migración 024):
 *  · canManage: CERRAR las apuestas y RESOLVER (decidir el resultado final) → el dueño y todos los moderadores, en cualquier mercado
 *  · canEdit: EDITAR (texto, foto, categoría, fechas) o abrirlo ya → el dueño, y cada moderador solo en los que él creó
 * Deshacer una resolución y anular un mercado son solo del dueño.
 */
const firstOf = (item) => item?.markets?.[0] || item?.market

export function useManage() {
  const { profile, isOwner, isStaff } = useAuth()
  const myId = profile?.id
  const canManage = useCallback((market) => !!market && !!isStaff, [isStaff])
  const canEdit = useCallback((market) => !!market && (isOwner || (!!myId && market.created_by === myId)), [isOwner, myId])
  /** Un item de la lista (mercado suelto o grupo): todas sus opciones tienen el mismo autor. */
  const canManageItem = useCallback((item) => canManage(firstOf(item)), [canManage])
  const canEditItem = useCallback((item) => canEdit(firstOf(item)), [canEdit])
  return { canManage, canManageItem, canEdit, canEditItem, isOwner }
}
