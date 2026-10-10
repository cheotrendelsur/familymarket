// Pantalla de acceso (Google + lista de invitados) y panel de invitaciones del dueño, en modo demo (no toca la base real).
import { describe, expect, it, vi } from 'vitest'
import { consoleErrors } from './setup'

const T = { timeout: 15000 }

async function boot(search, { ua } = {}) {
  vi.resetModules()
  window.sessionStorage.clear()
  window.localStorage.clear()
  if (ua) Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
  window.history.pushState({}, '', search)
  const rtl = await import('@testing-library/react')
  const { default: App } = await import('../src/App.jsx')
  rtl.render(<App />)
  return rtl
}

describe('Acceso con Google', () => {
  it('ofrece «Continuar con Google» como vía principal y entra al tocarlo', async () => {
    const { screen, fireEvent, cleanup } = await boot('/auth?mock=1&role=player&signedout=1')
    const google = await screen.findByRole('button', { name: /Continuar con Google/ }, T)
    // el correo y la contraseña quedan escondidos hasta que se pidan
    expect(screen.queryByLabelText('Correo electrónico')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Usar correo y contraseña/ }))
    expect(await screen.findByLabelText('Correo electrónico')).toBeTruthy()
    fireEvent.click(google)
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy() // dentro de la app
    cleanup()
  })

  it('si Google devuelve «correo no invitado», explica qué hacer', async () => {
    const { screen, cleanup } = await boot('/?mock=1&signedout=1&error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user')
    const alert = await screen.findByRole('alert', {}, T)
    expect(alert.textContent).toMatch(/no está en la lista de la familia/)
    expect(alert.textContent).toMatch(/Cheche/)
    expect(window.location.search).toBe('') // la dirección queda limpia
    cleanup()
  })

  it('avisa cuando la página está dentro de Instagram/Facebook (Google no deja entrar ahí)', async () => {
    const { screen, cleanup } = await boot('/auth?mock=1&signedout=1', {
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0',
    })
    expect(await screen.findByText(/Ábrelo en tu navegador/, {}, T)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copiar enlace/ })).toBeTruthy()
    cleanup()
  })

  it('en un navegador normal no muestra ese aviso', async () => {
    const { screen, cleanup } = await boot('/auth?mock=1&signedout=1', {
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    })
    await screen.findByRole('button', { name: /Continuar con Google/ }, T)
    expect(screen.queryByText(/Ábrelo en tu navegador/)).toBeNull()
    cleanup()
  })
})

describe('Dueño · invitar jugadores', () => {
  it('agrega correos a la lista, marca «con contraseña» y quita una invitación', async () => {
    const { screen, fireEvent, waitFor, within, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Gente' }, T))
    expect(await screen.findByText('Invitar jugadores', { selector: 'h2' }, T)).toBeTruthy()
    const pendingList = await screen.findByRole('list', { name: 'Invitaciones pendientes' }, T)
    expect(within(pendingList).getByText('abuela.rosa@gmail.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Invitar jugadores$/ }))
    const box = await screen.findByLabelText('Correos', {}, T)
    fireEvent.change(box, { target: { value: 'Tia.Marta@gmail.com, tio-pepe@yahoo.com\nesto-no-es-un-correo' } })
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la lista \(3\)/ }))
    expect(await screen.findByText(/2 agregados/, {}, T)).toBeTruthy()
    expect(screen.getByText(/no son correos válidos: esto-no-es-un-correo/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Cerrar' }).pop())

    const list = await screen.findByRole('list', { name: 'Invitaciones pendientes' }, T)
    expect(await within(list).findByText('tia.marta@gmail.com', {}, T)).toBeTruthy()

    // permitir contraseña a alguien que solo entra con Google
    fireEvent.click(within(list).getByRole('button', { name: 'Permitir contraseña a tia.marta@gmail.com' }))
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Quitar contraseña a tia.marta@gmail.com' })).toBeTruthy(), T)

    // quitar una invitación (pide confirmación)
    fireEvent.click(within(list).getByRole('button', { name: 'Quitar a tio-pepe@yahoo.com' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }, T))
    await waitFor(() => expect(within(list).queryByText('tio-pepe@yahoo.com')).toBeNull(), T)

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
    cleanup()
  })
})
