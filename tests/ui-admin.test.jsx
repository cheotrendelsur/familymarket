// E2E de la interfaz como DUEÑO (React real + backend real): crear, resolver, sugerencias, moderadores.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiClient, clearNotifications, goto, loginInBrowser } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }
const Q = '[TEST UI ADMIN] ¿Gana el equipo azul?'
const SUGGESTION = '[TEST UI ADMIN] ¿Aprobamos esta idea?'
let admin
let player3Id

const dialog = () => screen.getByRole('dialog')
const tab = (name) => screen.getByRole('button', { name })

beforeAll(async () => {
  admin = (await apiClient(0)).client
  const p3 = await apiClient(3)
  player3Id = p3.user.id
  await p3.client.rpc('suggest_market', { p_question: SUGGESTION, p_category: 'comida' })
  await clearNotifications(0)
  await loginInBrowser(0)
}, 120000)

afterAll(async () => {
  const { data } = await admin.from('markets').select('id').like('question', '[TEST UI ADMIN]%')
  for (const m of data || []) await admin.rpc('delete_market_and_refund', { p_market_id: m.id })
  await admin.rpc('admin_set_moderator', { p_user_id: player3Id, p_value: false })
})

describe('Dueño · panel', () => {
  it('crea y resuelve un mercado, aprueba una sugerencia, nombra un moderador y ve el registro', async () => {
    goto('/admin')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    expect(await screen.findByText('Panel del dueño', {}, T)).toBeTruthy()
    for (const label of ['Crear', 'Mercados', 'Jugadores', 'Actividad', 'Nueva partida']) expect(tab(label)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Sugerencias/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Admin/ })).toBeTruthy() // pestaña inferior visible

    // ---- crear mercado ----
    fireEvent.change(await screen.findByPlaceholderText('¿Lloverá mañana en Margarita?'), { target: { value: Q } })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar mercado' }))
    expect(await screen.findByText(/Mercado publicado/, {}, T)).toBeTruthy()

    // ---- resolver ----
    fireEvent.click(tab('Mercados'))
    const heading = await screen.findByText(Q, { selector: 'h3' }, T)
    fireEvent.click(within(heading.closest('div.rounded-2xl')).getByRole('button', { name: /Gana Sí/ }))
    expect(await screen.findByText('Resolver: gana «Sí»')).toBeTruthy()
    const confirmButtons = screen.getAllByRole('button', { name: 'Gana Sí' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(await screen.findByText(/Resuelto\. Ganó «Sí»/, {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Resueltos/ }))
    await waitFor(() => expect(screen.getAllByText('Ganó «Sí»').length).toBeGreaterThan(0), T)
    // el dueño ve el botón de deshacer la resolución
    expect(screen.getAllByRole('button', { name: /Deshacer/ }).length).toBeGreaterThan(0)

    // ---- sugerencias: aprobar la del jugador ----
    fireEvent.click(screen.getByRole('button', { name: /^Sugerencias/ }))
    const sug = await screen.findByText(SUGGESTION, {}, T)
    fireEvent.click(within(sug.closest('div.rounded-2xl')).getByRole('button', { name: /Aprobar/ }))
    expect(await screen.findByText('Foto (opcional)', {}, T)).toBeTruthy() // el formulario de aprobación trae selector de foto
    expect(within(dialog()).getByRole('button', { name: /Tomar foto/ })).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Publicar mercado' }))
    expect(await screen.findByText(/Publicado/, {}, T)).toBeTruthy()
    const { data: published } = await admin.from('markets').select('id, created_by').eq('question', SUGGESTION)
    expect(published?.length).toBe(1)
    const { data: notif } = await apiClient(3).then((x) => x.client.rpc('get_session_state'))
    expect(notif?.notifications?.some((n) => n.kind === 'SUGGESTION_APPROVED')).toBe(true)

    // ---- jugadores: nombrar moderador ----
    fireEvent.click(tab('Jugadores'))
    expect(await screen.findByText('lt_user_03', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByText('lt_user_03').closest('button'))
    fireEvent.click(await screen.findByRole('button', { name: 'Hacer moderador' }))
    expect(await screen.findByText(/ahora es moderador/, {}, T)).toBeTruthy()
    const { data: players } = await admin.rpc('admin_list_players')
    expect(players.find((p) => p.id === player3Id)?.is_moderator).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Es moderador' }))
    expect(await screen.findByText(/ya no es moderador/, {}, T)).toBeTruthy()

    // ---- registro de actividad ----
    fireEvent.click(tab('Actividad'))
    expect((await screen.findAllByText(/resolvió un mercado/i, {}, T)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/aprobó una sugerencia/i, {}, T)).length).toBeGreaterThan(0)

    // ---- nueva partida: el botón exige escribir REINICIAR ----
    fireEvent.click(tab('Nueva partida'))
    expect(screen.getByRole('button', { name: /Archivar y reiniciar partida/ }).disabled).toBe(true)

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 300000)
})
