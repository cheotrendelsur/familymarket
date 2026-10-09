// E2E del tutorial repetido a pedido por el DUEÑO: incluye las misiones extra de moderador y de dueño.
import { beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { clearNotifications, goto, loginInBrowser } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }

beforeAll(async () => {
  await clearNotifications(0)
  await loginInBrowser(0)
}, 120000)

describe('Tutorial · dueño (repetirlo desde Portafolio)', () => {
  it('muestra las misiones de moderador y de dueño y vuelve a la app al terminar', async () => {
    goto('/portfolio')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    const btn = (name) => screen.findByRole('button', { name }, T)
    const nextReady = async () => {
      await waitFor(() => expect(screen.getByRole('button', { name: /Siguiente/ }).disabled).toBe(false), T)
      fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    }

    // el tutorial ya no sale solo (ya lo vio), pero se puede repetir
    expect(await screen.findByText('Posiciones activas', {}, T)).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Tutorial de FamilyMarket' })).toBeNull()
    fireEvent.click(await btn(/Ver el tutorial otra vez/))
    expect(await screen.findByRole('dialog', { name: 'Tutorial de FamilyMarket' }, T)).toBeTruthy()

    fireEvent.click(await btn(/¡Empezar!/))
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

    // misión extra de moderador: publicar una sugerencia y resolver un mercado
    expect(await screen.findByText(/superpoderes/, {}, T)).toBeTruthy()
    fireEvent.click(await btn(/Publicar/))
    fireEvent.click(await btn('✓ Gana Sí'))
    expect(await screen.findByText(/Mercado resuelto/, {}, T)).toBeTruthy()
    await nextReady()

    // misión extra de dueño: nombrar a un moderador
    fireEvent.click(await btn('Hacer moderador a Tomi'))
    expect(await screen.findByText(/ya es moderador/, {}, T)).toBeTruthy()
    await nextReady()

    expect(await screen.findByText('¡Tutorial completado!', {}, T)).toBeTruthy()
    fireEvent.click(await btn(/¡Empezar a jugar!/))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Tutorial de FamilyMarket' })).toBeNull(), T)
    expect(screen.getByText('Posiciones activas')).toBeTruthy() // de vuelta en la app

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 300000)
})
