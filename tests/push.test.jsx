// Notificaciones push: el aviso sale cada vez que se abre la app hasta que se activen, y no sale más si ya están activas.
// Modo demo: ?push=ask|denied|install|old|active|unsupported simula la situación del teléfono.
import { describe, expect, it, vi } from 'vitest'

const T = { timeout: 15000 }

async function boot(path, { keepStorage = false } = {}) {
  vi.resetModules()
  window.sessionStorage.clear() // cada «boot» es una vez nueva que se abre la app
  if (!keepStorage) window.localStorage.clear()
  window.history.pushState({}, '', path)
  const rtl = await import('@testing-library/react')
  const { default: App } = await import('../src/App.jsx')
  rtl.render(<App />)
  return rtl
}

describe('Aviso para activar las notificaciones', () => {
  it('sale cada vez que se abre la app mientras no estén activadas (aunque diga «Ahora no»)', async () => {
    const first = await boot('/?mock=1&role=player&push=ask')
    const prompt = await first.screen.findByTestId('push-prompt', {}, T)
    expect(prompt.textContent).toMatch(/Activa las notificaciones/)
    expect(prompt.textContent).toMatch(/mercado nuevo/)
    first.fireEvent.click(first.screen.getByRole('button', { name: 'Ahora no' }))
    await first.waitFor(() => expect(first.screen.queryByTestId('push-prompt')).toBeNull(), T)
    first.cleanup()

    // se vuelve a abrir la app: vuelve a salir
    const second = await boot('/?mock=1&role=player&push=ask')
    expect(await second.screen.findByTestId('push-prompt', {}, T)).toBeTruthy()
    second.cleanup()
  })

  it('al tocar «Activar notificaciones» se activan y ya no vuelve a salir', async () => {
    const first = await boot('/?mock=1&role=player&push=ask')
    await first.screen.findByTestId('push-prompt', {}, T)
    first.fireEvent.click(first.screen.getByRole('button', { name: /Activar notificaciones/ }))
    await first.waitFor(() => expect(first.screen.queryByTestId('push-prompt')).toBeNull(), T)
    expect(window.__fmPush.status).toBe('active')
    first.cleanup()

    // con las notificaciones ya activas, al abrir la app no sale nada
    const second = await boot('/?mock=1&role=player&push=active')
    await second.screen.findByText('Valor total de la cuenta', {}, T).catch(() => {})
    await new Promise((r) => setTimeout(r, 3500))
    expect(second.screen.queryByTestId('push-prompt')).toBeNull()
    second.cleanup()
  })

  it('si el permiso está bloqueado explica cómo desbloquearlo', async () => {
    const { screen, fireEvent, cleanup } = await boot('/?mock=1&role=player&push=denied')
    const prompt = await screen.findByTestId('push-prompt', {}, T)
    expect(prompt.textContent).toMatch(/bloqueadas/)
    expect(prompt.textContent).toMatch(/Permisos|Ajustes/)
    expect(screen.getByRole('button', { name: 'Ya lo activé' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }))
    cleanup()
  })

  it('en iPhone sin instalar la app explica los 3 pasos para instalarla', async () => {
    const { screen, cleanup } = await boot('/?mock=1&role=player&push=install')
    const prompt = await screen.findByTestId('push-prompt', {}, T)
    expect(prompt.textContent).toMatch(/Instala la app/)
    expect(prompt.textContent).toMatch(/Agregar a pantalla de inicio/)
    expect(screen.getByTestId('install-steps').querySelectorAll('li').length).toBe(3)
    cleanup()
  })

  it('en un iPhone con iOS viejo se puede pedir que no vuelva a molestar', async () => {
    const first = await boot('/?mock=1&role=player&push=old')
    expect((await first.screen.findByTestId('push-prompt', {}, T)).textContent).toMatch(/iOS 16\.4/)
    first.fireEvent.click(first.screen.getByRole('button', { name: /No volver a mostrar/ }))
    await first.waitFor(() => expect(first.screen.queryByTestId('push-prompt')).toBeNull(), T)
    first.cleanup()

    const second = await boot('/?mock=1&role=player&push=old', { keepStorage: true })
    await new Promise((r) => setTimeout(r, 3500))
    expect(second.screen.queryByTestId('push-prompt')).toBeNull()
    second.cleanup()
  })

  it('no estorba la celebración de un resultado: espera a que se cierre', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/?mock=1&role=player&reward=1&push=ask')
    await screen.findByTestId('reward-card', {}, T)
    await new Promise((r) => setTimeout(r, 3500))
    expect(screen.queryByTestId('push-prompt')).toBeNull() // la tarjeta del premio va primero
    fireEvent.click(screen.getByRole('button', { name: /¡Genial!/ }))
    await waitFor(() => expect(screen.queryByTestId('reward-card')).toBeNull(), T)
    expect(await screen.findByTestId('push-prompt', {}, T)).toBeTruthy()
    cleanup()
  })

  it('sin soporte (navegador viejo o de otra app) no se molesta a nadie', async () => {
    const { screen, cleanup } = await boot('/?mock=1&role=player')
    await new Promise((r) => setTimeout(r, 3500))
    expect(screen.queryByTestId('push-prompt')).toBeNull()
    cleanup()
  })
})

describe('Portafolio → Notificaciones', () => {
  it('se activan desde el panel, se eligen los avisos, se manda una prueba y se pueden desactivar', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/portfolio?mock=1&role=player&push=ask')
    const card = await screen.findByTestId('notifications-card', {}, T)
    fireEvent.click(await screen.findByRole('button', { name: /Activar notificaciones/ }, T))
    expect(await screen.findByText('Activadas en este teléfono', {}, T)).toBeTruthy()

    const closing = screen.getByRole('switch', { name: 'Cierres' })
    expect(closing.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(closing)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Cierres' }).getAttribute('aria-checked')).toBe('false'), T)
    expect(card.querySelectorAll('[role=switch]').length).toBe(4)

    fireEvent.click(screen.getByRole('button', { name: 'Enviar una prueba' }))
    expect(await screen.findByText(/Prueba enviada/, {}, T)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }))
    expect(await screen.findByRole('button', { name: /Activar notificaciones/ }, T)).toBeTruthy()
    cleanup()
  })

  it('si el permiso está bloqueado lo explica; en iPhone sin instalar muestra los pasos', async () => {
    const denied = await boot('/portfolio?mock=1&role=player&push=denied')
    expect((await denied.screen.findByText('Las notificaciones están bloqueadas', {}, T))).toBeTruthy()
    denied.cleanup()
    const install = await boot('/portfolio?mock=1&role=player&push=install')
    expect(await install.screen.findByTestId('install-steps', {}, T)).toBeTruthy()
    install.cleanup()
  })
})
