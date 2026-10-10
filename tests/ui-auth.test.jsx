// Pantalla de acceso (Entrar / Soy nuevo con código de la familia / Google) y panel de registro del dueño, en modo demo
// (no toca la base real). En los datos de ejemplo el código de la familia es DEMO2026.
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

describe('Entrar', () => {
  it('con usuario y contraseña (sin correo)', async () => {
    const { screen, fireEvent, cleanup } = await boot('/auth?mock=1&role=player&signedout=1')
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' }, T)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Usuario o correo'), { target: { value: 'Mari_23' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'secreto1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    cleanup()
  })

  it('si Google está activado ofrece «Continuar con Google» y entra al tocarlo', async () => {
    const { screen, fireEvent, cleanup } = await boot('/auth?mock=1&role=player&signedout=1')
    fireEvent.click(await screen.findByRole('button', { name: /Continuar con Google/ }, T))
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    cleanup()
  })

  it('si Google devuelve «correo no invitado», explica qué hacer', async () => {
    const { screen, cleanup } = await boot('/?mock=1&signedout=1&error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user')
    const alert = await screen.findByRole('alert', {}, T)
    expect(alert.textContent).toMatch(/no está en la lista de la familia/)
    expect(alert.textContent).toMatch(/código de la familia/)
    expect(window.location.search).toBe('') // la dirección queda limpia
    cleanup()
  })

  it('avisa cuando la página está dentro de Instagram/Facebook (Google no deja entrar ahí)', async () => {
    const { screen, cleanup } = await boot('/auth?mock=1&signedout=1', {
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0',
    })
    expect(await screen.findByText(/Ábrelo en tu navegador/, {}, T)).toBeTruthy()
    cleanup()
  })
})

describe('Soy nuevo (código de la familia)', () => {
  it('crea la cuenta con código, nombre y contraseña, y entra a la app', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/auth?mock=1&role=player&signedout=1')
    fireEvent.click(await screen.findByRole('tab', { name: 'Soy nuevo' }, T))
    expect(await screen.findByRole('heading', { name: 'Crea tu cuenta' }, T)).toBeTruthy()

    // código incorrecto
    fireEvent.change(screen.getByLabelText('Código de la familia'), { target: { value: 'AAAA-BBBB' } })
    fireEvent.change(screen.getByLabelText('Tu nombre de jugador'), { target: { value: 'Nuevo_Jugador' } })
    fireEvent.change(screen.getByLabelText('Crea una contraseña'), { target: { value: 'secreto1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta y entrar' }))
    expect((await screen.findByRole('alert', {}, T)).textContent).toMatch(/código no es correcto/)

    // nombre ya usado (sin importar mayúsculas)
    fireEvent.change(screen.getByLabelText('Código de la familia'), { target: { value: 'demo-2026' } })
    fireEvent.change(screen.getByLabelText('Tu nombre de jugador'), { target: { value: 'CHECHE' } })
    await waitFor(() => expect(screen.getByText('Ese nombre ya está en uso')).toBeTruthy(), T)
    expect(screen.getByRole('button', { name: 'Crear mi cuenta y entrar' }).disabled).toBe(true)

    // todo bien
    fireEvent.change(screen.getByLabelText('Tu nombre de jugador'), { target: { value: 'Nuevo_Jugador' } })
    await waitFor(() => expect(screen.getByText('Disponible')).toBeTruthy(), T)
    fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta y entrar' }))
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    cleanup()
  })

  it('el link con el código ya trae el código escrito y abre «Soy nuevo»', async () => {
    const { screen, cleanup } = await boot('/auth?mock=1&role=player&signedout=1&codigo=DEMO2026')
    expect(await screen.findByRole('heading', { name: 'Crea tu cuenta' }, T)).toBeTruthy()
    expect(screen.getByLabelText('Código de la familia').value).toBe('DEMO-2026')
    cleanup()
  })
})

describe('Dueño · registro de jugadores', () => {
  it('ve el código, copia la invitación, cierra el registro, cambia el código y el máximo', async () => {
    const { screen, fireEvent, waitFor, within, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Gente' }, T))
    expect(await screen.findByText('Registro de jugadores', { selector: 'h2' }, T)).toBeTruthy()
    expect((await screen.findByLabelText('Código de la familia', {}, T)).textContent).toBe('DEMO-2026')
    expect(screen.getByRole('button', { name: /Copiar invitación para WhatsApp/ })).toBeTruthy()
    expect(screen.getByText('Registro abierto')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el registro' }))
    await waitFor(() => expect(screen.getByText('Registro cerrado')).toBeTruthy(), T)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir el registro' }))
    await waitFor(() => expect(screen.getByText('Registro abierto')).toBeTruthy(), T)

    fireEvent.click(screen.getByRole('button', { name: /Cambiar código/ }))
    await screen.findByText('Cambiar el código', {}, T)
    fireEvent.click(screen.getAllByRole('button', { name: 'Cambiar código' }).pop()) // confirmar (el botón del cuadro de diálogo)
    await waitFor(() => expect(screen.getByLabelText('Código de la familia').textContent).not.toBe('DEMO-2026'), T)

    fireEvent.change(screen.getByLabelText('Máximo de jugadores'), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(screen.getByText(/de 45 jugadores/)).toBeTruthy(), T)
    void within
    cleanup()
  })

  it('las invitaciones por correo quedan plegadas y se pueden usar (agregar, permitir contraseña, quitar)', async () => {
    const { screen, fireEvent, waitFor, within, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Gente' }, T))
    expect(screen.queryByText('Invitar jugadores', { selector: 'h2' })).toBeNull() // plegado
    fireEvent.click(await screen.findByRole('button', { name: /Invitar por correo \(opcional\)/ }, T))
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
    fireEvent.click(within(list).getByRole('button', { name: 'Permitir contraseña a tia.marta@gmail.com' }))
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Quitar contraseña a tia.marta@gmail.com' })).toBeTruthy(), T)
    fireEvent.click(within(list).getByRole('button', { name: 'Quitar a tio-pepe@yahoo.com' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }, T))
    await waitFor(() => expect(within(list).queryByText('tio-pepe@yahoo.com')).toBeNull(), T)

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
    cleanup()
  })
})
