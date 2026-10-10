import { useCallback, useEffect, useRef } from 'react'

/**
 * Ejecuta `callback` periódicamente con:
 *  · jitter (±25 %) para que miles de clientes no sincronicen sus peticiones
 *  · pausa automática cuando la pestaña está en segundo plano
 *  · refresco inmediato al volver a primer plano o recuperar la conexión
 *  · backoff exponencial (hasta ×5) si el servidor falla o está saturado
 *  · nunca solapa dos ejecuciones
 * Con `immediate: false` no ejecuta nada al montar (el llamador ya cargó el dato) y empieza a esperar el primer intervalo.
 * Devuelve `refresh()` para forzar una actualización manual.
 */
export function usePolling(callback, { interval = 12000, enabled = true, immediate = true } = {}) {
  const callbackRef = useRef(callback)
  const runningRef = useRef(false)
  const failuresRef = useRef(0)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const run = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      await callbackRef.current()
      failuresRef.current = 0
    } catch {
      failuresRef.current += 1
    } finally {
      runningRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    let timer = null

    function schedule() {
      if (cancelled) return
      const factor = Math.min(2 ** failuresRef.current, 5)
      const delay = interval * factor * (0.75 + Math.random() * 0.5)
      timer = setTimeout(tick, delay)
    }

    async function tick() {
      if (cancelled) return
      if (document.visibilityState !== 'hidden') await run()
      schedule()
    }

    function wake() {
      if (document.visibilityState === 'hidden') return
      clearTimeout(timer)
      tick()
    }

    if (immediate) run().finally(schedule)
    else schedule()
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
  }, [enabled, interval, immediate, run])

  return { refresh: run }
}
