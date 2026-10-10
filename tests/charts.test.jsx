// Gráficas: al cambiar de filtro se pide el dato al instante, las respuestas viejas no pisan a las nuevas,
// el dato anterior se conserva (atenuado) mientras llega el nuevo, y los ejes salen con marcas redondas.
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moneyScale, timeAxis } from '../src/lib/chartTime'
import { useSeries } from '../src/hooks/useSeries'

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useSeries · filtros de las gráficas', () => {
  it('carga al montar y al cambiar la clave pide el dato AL INSTANTE (sin esperar al refresco automático)', async () => {
    const calls = []
    const { result, rerender } = renderHook(({ range }) => useSeries(async () => {
      calls.push(range)
      return { range }
    }, `m|${range}`, { live: true, interval: 60000 }), { initialProps: { range: 'all' } })

    await waitFor(() => expect(result.current.data?.range).toBe('all'))
    expect(result.current.fresh).toBe(true)
    expect(calls).toEqual(['all']) // sin petición duplicada al montar

    rerender({ range: '1h' })
    await waitFor(() => expect(result.current.data?.range).toBe('1h'))
    expect(result.current.fresh).toBe(true)
    expect(calls).toEqual(['all', '1h'])
  })

  it('mientras llega el rango nuevo conserva el dato anterior (fresh = false) en vez de dejar el gráfico en blanco', async () => {
    const slow = deferred()
    const { result, rerender } = renderHook(({ range }) => useSeries(
      () => (range === 'all' ? Promise.resolve({ range }) : slow.promise), `m|${range}`, { live: false }
    ), { initialProps: { range: 'all' } })
    await waitFor(() => expect(result.current.data?.range).toBe('all'))

    rerender({ range: '6h' })
    expect(result.current.data?.range).toBe('all')
    expect(result.current.fresh).toBe(false)

    await act(async () => slow.resolve({ range: '6h' }))
    await waitFor(() => expect(result.current.data?.range).toBe('6h'))
    expect(result.current.fresh).toBe(true)
  })

  it('si cambias de filtro rápido, la respuesta vieja que llega tarde NO pisa a la nueva', async () => {
    const first = deferred()
    const second = deferred()
    const { result, rerender } = renderHook(({ range }) => useSeries(
      () => (range === '1h' ? first.promise : second.promise), `m|${range}`, { live: false }
    ), { initialProps: { range: '1h' } })

    rerender({ range: '1d' })
    await act(async () => second.resolve({ range: '1d' }))
    await waitFor(() => expect(result.current.data?.range).toBe('1d'))

    await act(async () => first.resolve({ range: '1h' })) // llega tarde
    expect(result.current.data?.range).toBe('1d')
    expect(result.current.fresh).toBe(true)
  })

  it('si falla y no hay dato avisa (failed) y se puede reintentar', async () => {
    let n = 0
    const { result } = renderHook(() => useSeries(async () => {
      n += 1
      if (n === 1) throw new Error('sin red')
      return { ok: true }
    }, 'm|all', { live: false }))
    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.data).toBeNull()

    await act(async () => result.current.reload())
    await waitFor(() => expect(result.current.data?.ok).toBe(true))
    expect(result.current.failed).toBe(false)
  })
})

describe('ejes de las gráficas', () => {
  const H = 3600e3

  it('tiempo: marcas en horas redondas, pocas y dentro del rango', () => {
    const min = Date.parse('2026-10-10T15:37:00Z')
    for (const span of [H, 6 * H, 24 * H, 5 * 24 * H]) {
      const { ticks, domain } = timeAxis(min, min + span)
      expect(domain).toEqual([min, min + span])
      expect(ticks.length).toBeGreaterThanOrEqual(2)
      expect(ticks.length).toBeLessThanOrEqual(6)
      expect(ticks.every((t) => t >= min && t <= min + span)).toBe(true)
      const step = ticks[1] - ticks[0]
      expect(ticks.every((t, i) => i === 0 || t - ticks[i - 1] === step)).toBe(true) // equiespaciadas
    }
    // 1 h => cada 15 min, alineadas al reloj local
    const { ticks } = timeAxis(min, min + H)
    expect(ticks[1] - ticks[0]).toBe(15 * 60e3)
    expect(new Date(ticks[0]).getMinutes() % 15).toBe(0)
  })

  it('tiempo: un rango vacío no revienta', () => {
    const { ticks } = timeAxis(1000, 1000)
    expect(ticks.length).toBe(1)
  })

  it('dinero: marcas redondas que nunca se repiten', () => {
    for (const [lo, hi] of [[983, 1117], [940, 1060], [0, 1], [1000, 1000], [4800, 9100], [120, 5400]]) {
      const { domain, ticks } = moneyScale(lo, hi)
      expect(domain[0]).toBeLessThanOrEqual(lo)
      expect(domain[1]).toBeGreaterThanOrEqual(hi)
      expect(new Set(ticks).size).toBe(ticks.length)
      expect(ticks.length).toBeLessThanOrEqual(6)
      const step = ticks[1] - ticks[0]
      expect(step % 1).toBe(0)
    }
    expect(moneyScale(983, 1117).ticks).toEqual([950, 1000, 1050, 1100, 1150])
  })
})
