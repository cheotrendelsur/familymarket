import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

/**
 * Qué mercados puede manejar (cerrar, editar, resolver) quien está usando la app:
 * el dueño, todos; un moderador, solo los que él creó. (El servidor lo exige igual: migración 016.)
 */
export function useManage() {
  const { profile, isOwner } = useAuth()
  const myId = profile?.id
  const canManage = useCallback((market) => !!market && (isOwner || (!!myId && market.created_by === myId)), [isOwner, myId])
  /** Un item de la lista (mercado suelto o grupo): todas sus opciones tienen el mismo autor. */
  const canManageItem = useCallback((item) => canManage(item?.markets?.[0] || item?.market), [canManage])
  return { canManage, canManageItem, isOwner }
}
