import { useEffect, useState } from 'react'

// Reloj del servidor: el celular de cada jugador puede tener la hora mal. El
// cierre de apuestas lo decide la base de datos, así que la cuenta regresiva
// usa (hora del dispositivo + diferencia medida contra el servidor).

let offsetMs = 0

export function setServerOffset(serverNowIso, requestStartedAt) {
  const server = Date.parse(serverNowIso)
  if (!Number.isFinite(server)) return
  // Compensa la mitad del viaje de ida y vuelta.
  const rtt = requestStartedAt ? Math.max(0, Date.now() - requestStartedAt) : 0
  offsetMs = server + rtt / 2 - Date.now()
}

export const serverNow = () => Date.now() + offsetMs

/** Hora del servidor que se refresca cada `intervalMs` (solo re-renderiza a quien la usa). */
export function useServerNow(intervalMs = 1000) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
