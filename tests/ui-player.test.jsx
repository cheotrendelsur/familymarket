// E2E de la interfaz como JUGADOR (React real + backend real).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiClient, goto, loginInBrowser } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }
let admin
let player
let ids = []

beforeAll(async () => {
  admin = (await apiClient(0)).client
  const single = await admin.rpc('admin_create_market', { p_question: '[TEST UI] ¿Habrá sol en Margarita?', p_description: 'prueba e2e' })
  const group = await admin.rpc('admin_create_market_group', {
    p_topic: '[TEST UI] ¿Quién gana el dominó?',
    p_options: ['[TEST UI] Papá', '[TEST UI] Tío'],
  })
  ids = [single.data, ...(group.data?.ids || [])]
  await loginInBrowser(3)
  player = (await apiClient(3)).client
}, 120000)

afterAll(async () => {
  for (const id of ids) await admin.rpc('delete_market_and_refund', { p_market_id: id })
})

describe('Jugador · flujo completo', () => {
  it('Home → comprar → Portafolio → Trade → Recuerdos', async () => {
    goto('/')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    // ---- HOME ----
    expect(await screen.findByText('Mercados Activos', {}, T)).toBeTruthy()
    expect(await screen.findByText('[TEST UI] ¿Habrá sol en Margarita?', {}, T)).toBeTruthy()
    expect(screen.getByText('[TEST UI] ¿Quién gana el dominó?')).toBeTruthy() // acordeón del mercado múltiple
    expect(screen.getByText('Ranking Familiar')).toBeTruthy()
    expect(await screen.findByText('Plemecho', {}, T)).toBeTruthy() // jugador real en el ranking
    expect(screen.getByText('@lt_user_03')).toBeTruthy()

    // ---- comprar YES desde la tarjeta ----
    const card = screen.getByText('[TEST UI] ¿Habrá sol en Margarita?').closest('div.bg-white')
    fireEvent.click(within(card).getByText('YES').closest('button'))
    expect(await screen.findByText('Operar', {}, T)).toBeTruthy()

    const input = await screen.findByLabelText(/Cantidad a invertir/)
    fireEvent.change(input, { target: { value: '25' } })
    expect(await screen.findByText('Resumen de la orden')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Comprar YES' }))

    expect(await screen.findByText('Confirmar compra de YES')).toBeTruthy()
    const confirmButtons = screen.getAllByRole('button', { name: 'Comprar' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(await screen.findByText('¡Compra exitosa!', {}, T)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Operar')).toBeNull(), T)

    // la compra quedó registrada en la base de datos
    const { data: shares } = await player.from('shares').select('side, count').eq('market_id', ids[0])
    expect(shares?.[0]?.side).toBe('YES')
    expect(Number(shares?.[0]?.count)).toBeGreaterThan(25)
    const { data: prof } = await player.from('profiles').select('balance').eq('id', (await player.auth.getUser()).data.user.id).single()
    expect(Number(prof.balance)).toBeCloseTo(975, 1)

    // ---- vender el 50 % de la posición ----
    const card2 = screen.getByText('[TEST UI] ¿Habrá sol en Margarita?').closest('div.bg-white')
    fireEvent.click(within(card2).getByText('YES').closest('button'))
    expect(await screen.findByText('Operar', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Vender' })) // pestaña Vender
    await screen.findByLabelText(/Acciones YES a vender/)
    await waitFor(() => expect(screen.getByRole('button', { name: '50%' }).disabled).toBe(false), T)
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(await screen.findByText('Resumen de la orden')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Vender YES' }))
    expect(await screen.findByText('Confirmar venta de YES')).toBeTruthy()
    const sellConfirm = screen.getAllByRole('button', { name: 'Vender' })
    fireEvent.click(sellConfirm[sellConfirm.length - 1])
    expect(await screen.findByText('¡Venta exitosa!', {}, T)).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Operar')).toBeNull(), T)
    const { data: after } = await player.from('shares').select('count').eq('market_id', ids[0]).eq('side', 'YES')
    expect(Number(after?.[0]?.count)).toBeGreaterThan(0)
    expect(Number(after?.[0]?.count)).toBeLessThan(Number(shares?.[0]?.count))

    // ---- PORTAFOLIO ----
    fireEvent.click(screen.getByRole('button', { name: /Portfolio/ }))
    expect(await screen.findByText('Posiciones Activas', {}, T)).toBeTruthy()
    expect(await screen.findByText('[TEST UI] ¿Habrá sol en Margarita?', {}, T)).toBeTruthy()
    expect(screen.getByText('Valor total de la cuenta')).toBeTruthy()
    fireEvent.click(screen.getByText('Historial de operaciones'))
    expect(await screen.findByText('Compra', {}, T)).toBeTruthy()

    // ---- TRADE ----
    fireEvent.click(screen.getByRole('button', { name: /Trade/ }))
    expect(await screen.findByText('Operar', {}, T)).toBeTruthy()
    expect(screen.getAllByText(/Habrá sol en Margarita/).length).toBeGreaterThan(0)

    // ---- RECUERDOS ----
    fireEvent.click(screen.getByRole('button', { name: /Recuerdos/ }))
    expect(await screen.findByText('FamilyMarket · Febrero 2026', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByText('FamilyMarket · Febrero 2026').closest('button'))
    expect(await screen.findByText('Ranking final', {}, T)).toBeTruthy()
    expect(await screen.findByText('Plemecho', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByText('Plemecho').closest('button'))
    expect(await screen.findByText('Portafolio', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Operaciones/ }))
    expect((await screen.findAllByText(/Compra|Venta|Pago/, {}, T)).length).toBeGreaterThan(0)

    // la app no tuvo errores de React durante todo el recorrido
    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 240000)
})
