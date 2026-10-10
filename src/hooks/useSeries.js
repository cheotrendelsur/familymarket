import { useCallback, useEffect, useRef, useState } from 'react'
import { usePolling } from './usePolling'

/**
 * Carga la serie de datos de un gráfico para una `key` (mercado + rango, jugador + rango…).
 *
 *  · pide el dato AL INSTANTE cuando cambia la `key` (antes se esperaba al siguiente refresco automático,
 *    y por eso, al cambiar de filtro, el gráfico se quedaba en blanco o con el rango anterior)
 *  · ignora las respuestas viejas que llegan tarde (si cambias de filtro rápido, gana la última petición)
 *  · conserva el dato anterior mientras llega el nuevo (`fresh = false`) para que no parpadee ni salte
 *  · se refresca solo cada `interval` si `live`, y avisa si falló (`failed`) para poder reintentar
 *
 * `fetcher()` devuelve lo que el gráfico necesite (por ejemplo `{ rows, since, until }`).
 */
export function useSeries(fetcher, key, { live = true, interval = 25000 } = {}) {
  const [state, setState] = useState({ key: null, data: null, failedKey: null })
  const fetcherRef = useRef(fetcher)
  const keyRef = useRef(key)
  const seqRef = useRef(0)

  useEffect(() => {
    fetcherRef.current = fetcher
    keyRef.current = key
  })

  const load = useCallback(async () => {
    const myKey = keyRef.current
    const mySeq = ++seqRef.current
    try {
      const data = await fetcherRef.current()
      if (mySeq !== seqRef.current) return
      setState({ key: myKey, data, failedKey: null })
    } catch (err) {
      if (mySeq !== seqRef.current) return
      setState((s) => ({ ...s, failedKey: myKey }))
      throw err
    }
  }, [])

  useEffect(() => {
    load().catch(() => {})
  }, [key, load])

  usePolling(load, { interval, enabled: live, immediate: false })

  return {
    data: state.data,
    fresh: state.key === key,
    failed: state.failedKey === key && state.key !== key,
    reload: () => load().catch(() => {}),
  }
}
