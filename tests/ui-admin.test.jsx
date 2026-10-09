// E2E de la interfaz como DUEÑO (React real + backend real): crear, resolver, sugerencias, moderadores.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { apiClient, clearNotifications, goto, loginInBrowser } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }
const Q = '[TEST UI ADMIN] ¿Gana el equipo azul?'
const SUGGESTION = '[TEST UI ADMIN] ¿Aprobamos esta idea?'
const SUGGESTION_EDIT = '[TEST UI ADMIN] ¿Editamos esta otra idea?'
let admin
let player3Id

const dialog = () => screen.getByRole('dialog')
const tab = (name) => screen.getByRole('button', { name })
const cardOf = (el) => el.closest('div.rounded-2xl')

beforeAll(async () => {
  admin = (await apiClient(0)).client
  const p3 = await apiClient(3)
  player3Id = p3.user.id
  await p3.client.rpc('suggest_market', { p_question: SUGGESTION, p_category: 'comida' })
  await p3.client.rpc('suggest_market', { p_question: SUGGESTION_EDIT, p_category: 'juegos' })
  await clearNotifications(0)
  await loginInBrowser(0)
}, 120000)

afterAll(async () => {
  const { data } = await admin.from('markets').select('id').like('question', '[TEST UI ADMIN]%')
  for (const m of data || []) await admin.rpc('delete_market_and_refund', { p_market_id: m.id })
  await admin.rpc('admin_set_moderator', { p_user_id: player3Id, p_value: false })
})

describe('Dueño · panel', () => {
  it('crea y resuelve un mercado, publica sugerencias, nombra un moderador y ve el registro', async () => {
    goto('/admin')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    // ---- pantalla «Hoy» ----
    expect(await screen.findByText('Panel del dueño', {}, T)).toBeTruthy()
    for (const label of [/^Hoy/, 'Crear', 'Mercados', 'Gente', 'Más']) expect(tab(label)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Admin/ })).toBeTruthy() // pestaña inferior visible
    expect(await screen.findByText('Sugerencias nuevas', {}, T)).toBeTruthy()
    expect(screen.getByText('Crear un mercado')).toBeTruthy()

    // ---- crear mercado ----
    fireEvent.click(tab('Crear'))
    fireEvent.change(await screen.findByPlaceholderText('¿Lloverá mañana en Margarita?'), { target: { value: Q } })
    expect(screen.getByRole('button', { name: 'Tomar foto' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'En 2 horas' })) // atajo de cierre
    fireEvent.click(screen.getByRole('button', { name: 'Publicar mercado' }))
    expect(await screen.findByText(/Mercado publicado/, {}, T)).toBeTruthy()

    // ---- resolver desde «Mercados» ----
    fireEvent.click(tab('Mercados'))
    const heading = await screen.findByText(Q, { selector: 'h3' }, T)
    fireEvent.click(within(cardOf(heading)).getByRole('button', { name: /Gana Sí/ }))
    expect(await screen.findByText('Resolver: gana «Sí»')).toBeTruthy()
    const confirmButtons = screen.getAllByRole('button', { name: 'Gana Sí' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])
    expect(await screen.findByText(/Resuelto\. Ganó «Sí»/, {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Resueltos/ }))
    const resolvedHeading = await screen.findByText(Q, { selector: 'h3' }, T)
    expect(within(cardOf(resolvedHeading)).getByText('Ganó «Sí»')).toBeTruthy()
    // el dueño puede deshacer la resolución desde el menú «⋯»
    fireEvent.click(within(cardOf(resolvedHeading)).getByRole('button', { name: 'Más acciones' }))
    expect(await screen.findByText('Deshacer la resolución', {}, T)).toBeTruthy()
    expect(screen.getByText('Anular y borrar')).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByText('Deshacer la resolución')).toBeNull(), T)

    // ---- sugerencias en «Hoy»: publicar de un toque ----
    fireEvent.click(screen.getByRole('button', { name: /^Hoy/ }))
    const sug = await screen.findByText(SUGGESTION, {}, T)
    fireEvent.click(within(cardOf(sug)).getByRole('button', { name: /Publicar/ }))
    expect(await screen.findByText(/Publicado/, {}, T)).toBeTruthy()
    const { data: published } = await admin.from('markets').select('id').eq('question', SUGGESTION)
    expect(published?.length).toBe(1)

    // ---- sugerencias: editar y publicar (con selector de foto) ----
    const sug2 = await screen.findByText(SUGGESTION_EDIT, {}, T)
    fireEvent.click(within(cardOf(sug2)).getByRole('button', { name: /Editar/ }))
    expect(await screen.findByText('Foto', {}, T)).toBeTruthy()
    expect(within(dialog()).getByRole('button', { name: /Tomar foto/ })).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Publicar mercado' }))
    await waitFor(async () => {
      const { data } = await admin.from('markets').select('id').eq('question', SUGGESTION_EDIT)
      expect(data?.length).toBe(1)
    }, T)
    const { data: notif } = await apiClient(3).then((x) => x.client.rpc('get_session_state'))
    expect(notif?.notifications?.filter((n) => n.kind === 'SUGGESTION_APPROVED').length).toBe(2)

    // ---- gente: nombrar moderador con el interruptor de la fila ----
    fireEvent.click(tab('Gente'))
    expect(await screen.findByText('lt_user_03', {}, T)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Hacer moderador a lt_user_03' }))
    expect(await screen.findByText(/ahora es moderador/, {}, T)).toBeTruthy()
    const { data: players } = await admin.rpc('admin_list_players')
    expect(players.find((p) => p.id === player3Id)?.is_moderator).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar de moderador a lt_user_03' }))
    expect(await screen.findByText(/ya no es moderador/, {}, T)).toBeTruthy()

    // ---- «Más»: registro de actividad y nueva partida ----
    fireEvent.click(tab('Más'))
    fireEvent.click(await screen.findByRole('button', { name: /Registro de actividad/ }))
    expect((await screen.findAllByText(/resolvió un mercado/i, {}, T)).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/aprobó una sugerencia/i, {}, T)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /Empezar una partida nueva/ }))
    expect(screen.getByRole('button', { name: /Archivar y reiniciar partida/ }).disabled).toBe(true) // exige escribir REINICIAR

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 300000)
})
