// E2E de la interfaz como ADMIN (React real + backend real).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiClient, goto, loginInBrowser } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }
let admin

beforeAll(async () => {
  admin = (await apiClient(0)).client
  await loginInBrowser(0)
}, 120000)

afterAll(async () => {
  const { data } = await admin.from('markets').select('id').like('question', '[TEST UI ADMIN]%')
  for (const m of data || []) await admin.rpc('delete_market_and_refund', { p_market_id: m.id })
})

describe('Admin · panel', () => {
  it('crea un mercado, lo resuelve y muestra el registro de actividad', async () => {
    goto('/admin')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    expect(await screen.findByText('Panel de administración', {}, T)).toBeTruthy()
    expect(screen.getByText('Nueva partida')).toBeTruthy()

    // el botón de reinicio exige escribir REINICIAR
    const resetBtn = screen.getByRole('button', { name: /Archivar y reiniciar partida/ })
    expect(resetBtn.disabled).toBe(true)

    // ---- crear mercado ----
    const q = await screen.findByPlaceholderText('¿Lloverá mañana en Margarita?')
    fireEvent.change(q, { target: { value: '[TEST UI ADMIN] ¿Gana el equipo azul?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear mercado' }))
    expect(await screen.findByText('✅ Mercado creado exitosamente', {}, T)).toBeTruthy()
    expect(await screen.findByText('[TEST UI ADMIN] ¿Gana el equipo azul?', {}, T)).toBeTruthy()

    // ---- resolver ----
    const card = screen.getByText('[TEST UI ADMIN] ¿Gana el equipo azul?', { selector: 'h3' }).closest('div.border-2')
    fireEvent.click(within(card).getByRole('button', { name: /Gana YES/ }))
    expect(await screen.findByText('Resolver como YES')).toBeTruthy()
    const confirmButtons = screen.getAllByRole('button', { name: 'Gana YES' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(await screen.findByText(/Resuelto\. Ganó YES/, {}, T)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText('GANÓ YES').length).toBeGreaterThan(0), T)

    // ---- registro de actividad ----
    expect(await screen.findByText('Registro de actividad del admin', {}, T)).toBeTruthy()
    expect((await screen.findAllByText('Resolvió un mercado', {}, T)).length).toBeGreaterThan(0)

    // ---- pestaña Admin visible en la barra inferior ----
    expect(screen.getByRole('button', { name: /Admin/ })).toBeTruthy()

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 240000)
})
