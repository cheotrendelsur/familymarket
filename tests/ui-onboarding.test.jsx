// E2E del alta de un jugador NUEVO con el código de la familia:
//   «Soy nuevo» (código + nombre + contraseña) -> tutorial -> juego -> salir -> entrar con su usuario.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createClient } from '@supabase/supabase-js'
import { apiClient, creds, goto } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }

describe('Alta de jugador nuevo', () => {
  it('se registra con el código de la familia, hace el tutorial, aparece en el ranking, cierra sesión y vuelve a entrar con su usuario', async () => {
    window.localStorage.clear()
    const c = creds()
    const suffix = Math.random().toString(16).slice(2, 8)
    const username = `lt_n${suffix}`

    // el código vigente (solo el dueño puede verlo)
    const owner = (await apiClient(0)).client
    const info = await owner.rpc('admin_get_signup')
    expect(info.error).toBeNull()
    const code = info.data.code
    expect(info.data.is_open).toBe(true)

    goto('/auth')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    // ---- pantalla de acceso: «Entrar» por defecto, «Soy nuevo» para registrarse ----
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' }, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Soy nuevo' }))
    expect(await screen.findByRole('heading', { name: 'Crea tu cuenta' }, T)).toBeTruthy()

    const fill = (codeValue, nameValue) => {
      fireEvent.change(screen.getByLabelText('Código de la familia'), { target: { value: codeValue } })
      fireEvent.change(screen.getByLabelText('Tu nombre de jugador'), { target: { value: nameValue } })
      fireEvent.change(screen.getByLabelText('Crea una contraseña'), { target: { value: c.password } })
      fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta y entrar' }))
    }

    // 1) código incorrecto: no se crea nada
    fill('ZZZZ-ZZZZ', username)
    expect((await screen.findByRole('alert', {}, T)).textContent).toMatch(/código no es correcto/)
    expect(screen.queryByText('¡Tutorial completado!')).toBeNull()

    // 2) nombre ya usado (sin importar mayúsculas): se avisa antes de crear la cuenta
    fill(code, 'CHECHE')
    expect(await screen.findByText(/Ese nombre ya está en uso/, {}, T)).toBeTruthy()

    // 3) todo bien: la cuenta se crea y entra directo (sin pedir correo ni elegir nombre otra vez)
    fill(code.toLowerCase(), username)

    // ---- tutorial interactivo (una sola vez): hay que hacer cada operación ----
    const btn = (name) => screen.findByRole('button', { name }, T)
    const nextReady = async () => {
      await waitFor(() => expect(screen.getByRole('button', { name: /Siguiente/ }).disabled).toBe(false), T)
      fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    }
    expect(await screen.findByText(/Soy/, {}, T)).toBeTruthy() // Fami da la bienvenida
    expect(screen.queryByLabelText('Buscar mercados')).toBeNull() // la app todavía no se muestra
    fireEvent.click(await btn(/¡Empezar!/))
    // Misión 1: leer el mercado
    expect(screen.getByRole('button', { name: /Toca el botón «Sí»/ }).disabled).toBe(true) // no deja avanzar sin hacerlo
    fireEvent.click(await btn('Comprar Sí a 40 centavos'))
    await nextReady()
    // Misión 2: primera compra
    fireEvent.click(await btn('$10'))
    fireEvent.click(await btn(/^Comprar Sí · \$10\.00/))
    expect(await screen.findByText('¡Compra hecha!', {}, T)).toBeTruthy()
    await nextReady()
    // Misión 3: el precio se mueve y se vende
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vender la mitad' }).disabled).toBe(false), T)
    fireEvent.click(screen.getByRole('button', { name: 'Vender la mitad' }))
    await nextReady()
    // Misión 4: reintentar al nuevo precio
    fireEvent.click(await btn(/^Comprar Sí · \$10\.00/))
    fireEvent.click(await btn(/^Reintentar a/))
    await nextReady()
    // Misión 5: cierre y resultado
    fireEvent.click(await btn(/Adelantar el reloj/))
    fireEvent.click(await btn('Gana Sí'))
    expect(await screen.findByText('¡Ganaste!', {}, T)).toBeTruthy()
    fireEvent.click(await btn(/A cobrar/))
    await nextReady()
    // Misión 6: ranking y perfil
    fireEvent.click(await btn(/Yudrexi/))
    expect(await screen.findByText(/Aciertos/, {}, T)).toBeTruthy()
    await nextReady()
    // Misión 7: moverse por la app (3 pestañas)
    for (const tab of ['Inicio', 'Ranking', 'Portafolio']) fireEvent.click(await screen.findByRole('tab', { name: tab }))
    await nextReady()
    // Meta
    expect(await screen.findByText('¡Tutorial completado!', {}, T)).toBeTruthy()
    fireEvent.click(await btn(/¡Empezar a jugar!/))

    // ---- ya dentro del juego ----
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    expect(await screen.findByText(`@${username}`, {}, T)).toBeTruthy()
    expect(screen.getByLabelText('Saldo disponible').textContent).toContain('1,000.00') // el tutorial usó dinero de práctica

    // el servidor recuerda que ya vio el tutorial (vale en cualquier dispositivo)
    const check = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const login = await check.auth.signInWithPassword({ email: `${username}@jugador.familymarket.invalid`, password: c.password })
    expect(login.error).toBeNull()
    const { data: row } = await check.from('profiles').select('tour_completed_at, balance, username, is_admin, is_moderator').single()
    expect(row.tour_completed_at).not.toBeNull()
    expect(Number(row.balance)).toBe(1000)
    expect(row.username).toBe(username)
    expect(row.is_admin || row.is_moderator).toBe(false)

    // aparece en el ranking
    fireEvent.click(screen.getByRole('link', { name: /Ranking/ }))
    expect((await screen.findAllByText(username, {}, T)).length).toBeGreaterThan(0)

    // ---- salir ----
    fireEvent.click(screen.getByLabelText('Cerrar sesión'))
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' }, T)).toBeTruthy()

    // ---- contraseña incorrecta ----
    fireEvent.change(screen.getByLabelText('Usuario o correo'), { target: { value: username } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'incorrecta123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText(/Usuario o contraseña incorrectos/, {}, T)).toBeTruthy()

    // ---- entrar bien, solo con su nombre de usuario ----
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: c.password } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(|AuthApiError|Invalid login/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 240000)
})
