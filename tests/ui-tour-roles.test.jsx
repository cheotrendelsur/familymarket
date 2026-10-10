// El tutorial según el rol (usa el modo demo de la interfaz: no toca la base real).
//   jugador   -> tutorial de jugador (7 misiones)
//   moderador -> el mismo + su misión de moderación (8 misiones)
//   dueño     -> no se le muestra solo; si lo repite desde Portafolio ve el de jugador (7)
import { describe, expect, it, vi } from 'vitest'
import { consoleErrors } from './setup'

const T = { timeout: 15000 }

/** Arranca la app en modo demo con el rol dado (módulos nuevos en cada arranque). */
async function boot(role) {
  vi.resetModules()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.history.pushState({}, '', `/?mock=1&role=${role}&tour=1`)
  const rtl = await import('@testing-library/react')
  const { default: App } = await import('../src/App.jsx')
  rtl.render(<App />)
  return rtl
}

describe('Tutorial por rol', () => {
  it('jugador: ve el tutorial de jugador (7 misiones) y nada de moderación', async () => {
    const { screen, fireEvent, cleanup } = await boot('player')
    expect(await screen.findByRole('dialog', { name: 'Tutorial de FamilyMarket' }, T)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /¡Empezar!/ }, T))
    expect(await screen.findByText('Misión 1 de 7', {}, T)).toBeTruthy()
    cleanup()
  })

  it('moderador: ve las 8 misiones y practica publicar una sugerencia y resolver', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('mod')
    const btn = (name) => screen.findByRole('button', { name }, T)
    const nextReady = async () => {
      await waitFor(() => expect(screen.getByRole('button', { name: /Siguiente/ }).disabled).toBe(false), T)
      fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    }
    expect(await screen.findByRole('dialog', { name: 'Tutorial de FamilyMarket' }, T)).toBeTruthy()
    fireEvent.click(await btn(/¡Empezar!/))
    expect(await screen.findByText('Misión 1 de 8', {}, T)).toBeTruthy()

    fireEvent.click(await btn('Comprar Sí a 40 centavos'))
    await nextReady()
    fireEvent.click(await btn('$10'))
    fireEvent.click(await btn(/^Comprar Sí · \$10\.00/))
    await nextReady()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vender la mitad' }).disabled).toBe(false), T)
    fireEvent.click(screen.getByRole('button', { name: 'Vender la mitad' }))
    await nextReady()
    fireEvent.click(await btn(/^Comprar Sí · \$10\.00/))
    fireEvent.click(await btn(/^Reintentar a/))
    await nextReady()
    fireEvent.click(await btn(/Adelantar el reloj/))
    fireEvent.click(await btn('Gana Sí'))
    fireEvent.click(await btn(/A cobrar/))
    await nextReady()
    fireEvent.click(await btn(/Yudrexi/))
    await nextReady()
    for (const tab of ['Inicio', 'Ranking', 'Portafolio']) fireEvent.click(await screen.findByRole('tab', { name: tab }))
    await nextReady()

    // misión de moderador
    expect(await screen.findByText('Misión 8 de 8', {}, T)).toBeTruthy()
    expect(await screen.findByText(/superpoderes/, {}, T)).toBeTruthy()
    fireEvent.click(await btn(/Publicar/))
    fireEvent.click(await btn('✓ Gana Sí'))
    expect(await screen.findByText(/Mercado resuelto/, {}, T)).toBeTruthy()
    await nextReady()

    // sin misión de dueño: se pasa directo a la meta
    expect(await screen.findByText('¡Tutorial completado!', {}, T)).toBeTruthy()
    fireEvent.click(await btn(/¡Empezar a jugar!/))
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    cleanup()
  })

  it('dueño: no le sale solo; si lo repite desde Portafolio ve el de jugador (sin moderación ni dueño)', async () => {
    const { screen, fireEvent, cleanup } = await boot('owner')
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy() // entra directo a la app
    expect(screen.queryByRole('dialog', { name: 'Tutorial de FamilyMarket' })).toBeNull()

    fireEvent.click(await screen.findByRole('link', { name: /Portafolio/ }, T))
    fireEvent.click(await screen.findByRole('button', { name: /Ver el tutorial otra vez/ }, T))
    expect(await screen.findByRole('dialog', { name: 'Tutorial de FamilyMarket' }, T)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /¡Empezar!/ }, T))
    expect(await screen.findByText('Misión 1 de 7', {}, T)).toBeTruthy()
    cleanup()

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  })
})
