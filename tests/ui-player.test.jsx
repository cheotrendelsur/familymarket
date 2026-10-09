// E2E de la interfaz como JUGADOR (React real + backend real).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiClient, clearNotifications, goto, loginInBrowser } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }
const Q = '[TEST UI] ¿Habrá sol en Margarita?'
let admin
let player
let ids = []

const cardOf = (text) =>
  screen
    .getAllByText(text)
    .map((el) => el.closest('article'))
    .filter(Boolean)[0]
const dialog = () => screen.getByRole('dialog')

beforeAll(async () => {
  admin = (await apiClient(0)).client
  const single = await admin.rpc('staff_create_market', {
    p_question: Q,
    p_description: 'prueba e2e',
    p_category: 'clima',
    p_closes_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
  })
  const group = await admin.rpc('staff_create_market_group', {
    p_topic: '[TEST UI] ¿Quién gana el dominó?',
    p_options: ['[TEST UI] Papá', '[TEST UI] Tío'],
    p_category: 'juegos',
  })
  ids = [single.data, ...(group.data?.ids || [])]
  await clearNotifications(3)
  await loginInBrowser(3)
  player = (await apiClient(3)).client
}, 120000)

afterAll(async () => {
  for (const id of ids) await admin.rpc('delete_market_and_refund', { p_market_id: id })
})

describe('Jugador · flujo completo', () => {
  it('Inicio → comprar → vender → Portafolio → Ranking → Sugerir → Recuerdos', async () => {
    goto('/')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    // ---- INICIO ----
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    expect((await screen.findAllByText(Q, {}, T)).length).toBeGreaterThan(0)
    expect(screen.getByText('[TEST UI] ¿Quién gana el dominó?')).toBeTruthy() // tarjeta del mercado múltiple
    expect(screen.getByText('@lt_user_03')).toBeTruthy()
    expect(await screen.findByText('EN VIVO', {}, T)).toBeTruthy() // cinta de actividad

    // búsqueda: filtra y se puede limpiar
    const search = screen.getByLabelText('Buscar mercados')
    fireEvent.change(search, { target: { value: 'dominó' } })
    await waitFor(() => expect(screen.queryAllByText(Q).length).toBe(0))
    expect(screen.getByText('[TEST UI] ¿Quién gana el dominó?')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'zzzz-nada' } })
    expect(await screen.findByText('Nada coincide con tu búsqueda')).toBeTruthy()
    fireEvent.click(screen.getByText('Quitar filtros'))
    expect((await screen.findAllByText(Q, {}, T)).length).toBeGreaterThan(0)

    // ---- comprar «Sí» desde la tarjeta ----
    fireEvent.click(within(cardOf(Q)).getByRole('button', { name: /Comprar Sí/ }))
    expect(await screen.findByText('Operar', {}, T)).toBeTruthy()
    fireEvent.change(await screen.findByLabelText(/Cuánto quieres invertir/), { target: { value: '25' } })
    expect(await screen.findByText(/Si gana «Sí» recibes/)).toBeTruthy()
    expect(within(dialog()).getByText(/Tolerancia de precio:/).textContent).toContain('5%') // tolerancia por defecto 5 %
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Comprar Sí/ }))

    expect(await screen.findByText('¡Compra hecha!', {}, T)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Operar')).toBeNull(), { timeout: 20000 })

    // la compra quedó registrada en la base de datos
    const { data: shares } = await player.from('shares').select('side, count').eq('market_id', ids[0])
    expect(shares?.[0]?.side).toBe('YES')
    expect(Number(shares?.[0]?.count)).toBeGreaterThan(25)
    const { data: prof } = await player.from('profiles').select('balance').eq('id', (await player.auth.getUser()).data.user.id).single()
    expect(Number(prof.balance)).toBeCloseTo(975, 1)

    // ---- vender el 50 % de la posición ----
    fireEvent.click(within(cardOf(Q)).getByRole('button', { name: /Comprar Sí/ }))
    expect(await screen.findByText('Operar', {}, T)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Vender' }))
    await screen.findByLabelText(/Cuántas acciones/)
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: '50%' }).disabled).toBe(false), T)
    fireEvent.click(within(dialog()).getByRole('button', { name: '50%' }))
    expect(await screen.findByText('Recibes ahora')).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: /^Vender Sí/ }))
    expect(await screen.findByText('¡Venta hecha!', {}, T)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Operar')).toBeNull(), { timeout: 20000 })
    const { data: after } = await player.from('shares').select('count').eq('market_id', ids[0]).eq('side', 'YES')
    expect(Number(after?.[0]?.count)).toBeGreaterThan(0)
    expect(Number(after?.[0]?.count)).toBeLessThan(Number(shares?.[0]?.count))

    // ---- DETALLE del mercado ----
    fireEvent.click(cardOf(Q))
    expect(await screen.findByText('de probabilidad de «Sí»', {}, T)).toBeTruthy()
    expect(await screen.findByText('Tu posición', {}, T)).toBeTruthy()
    expect(await screen.findByText('Movimientos recientes', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }))

    // ---- PORTAFOLIO ----
    fireEvent.click(screen.getByRole('link', { name: /Portafolio/ }))
    expect(await screen.findByText('Posiciones activas', {}, T)).toBeTruthy()
    expect(await screen.findByText(Q, {}, T)).toBeTruthy()
    expect(screen.getByText('Valor total de la cuenta')).toBeTruthy()
    fireEvent.click(screen.getByText('Historial de operaciones'))
    expect((await screen.findAllByText('Compra', {}, T)).length).toBeGreaterThan(0)

    // ---- RANKING ----
    fireEvent.click(screen.getByRole('link', { name: /Ranking/ }))
    expect(await screen.findByText('Ranking familiar', {}, T)).toBeTruthy()
    expect(await screen.findByText('Tu posición', {}, T)).toBeTruthy()
    expect((await screen.findAllByText('Plemecho', {}, T)).length).toBeGreaterThan(0)
    expect(await screen.findByText('Carrera de patrimonio', {}, T)).toBeTruthy()
    fireEvent.click(screen.getAllByText('Plemecho')[0].closest('button'))
    expect(await screen.findByText('Aciertos', {}, T)).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cerrar' }))

    // ---- SUGERIR ----
    fireEvent.click(screen.getByRole('link', { name: /Sugerir/ }))
    expect(await screen.findByText('Sugerir un mercado', {}, T)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Tu pregunta'), { target: { value: '[TEST UI] ¿Aprobarán esta sugerencia?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar sugerencia' }))
    expect(await screen.findByText(/Sugerencia enviada/, {}, T)).toBeTruthy()
    expect(await screen.findByText('[TEST UI] ¿Aprobarán esta sugerencia?', {}, T)).toBeTruthy()
    expect(screen.getByText('En revisión')).toBeTruthy()

    // ---- RECUERDOS ----
    fireEvent.click(screen.getByRole('link', { name: /Recuerdos/ }))
    expect(await screen.findByText('FamilyMarket · Febrero 2026', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByText('FamilyMarket · Febrero 2026').closest('button'))
    expect(await screen.findByText('Ranking final', {}, T)).toBeTruthy()
    expect(await screen.findByText('Plemecho', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByText('Plemecho').closest('button'))
    expect(await screen.findByRole('button', { name: /Portafolio/ }, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Operaciones/ }))
    expect((await screen.findAllByText(/Compra|Venta|Pago/, {}, T)).length).toBeGreaterThan(0)

    // la app no tuvo errores de React durante todo el recorrido
    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 300000)
})
