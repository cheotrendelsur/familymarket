// E2E del alta de un jugador NUEVO: registro -> nombre de usuario -> juego -> salir -> entrar.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createClient } from '@supabase/supabase-js'
import { apiClient, creds, goto } from './helpers'
import { consoleErrors } from './setup'

const T = { timeout: 45000 }

describe('Alta de jugador nuevo', () => {
  it('se registra, elige nombre, aparece en el ranking, cierra sesión y vuelve a entrar', async () => {
    window.localStorage.clear()
    const c = creds()
    const suffix = Math.random().toString(16).slice(2, 8)
    const email = `lt_signup_${suffix}@${c.domain}`
    const username = `lt_n${suffix}`

    goto('/auth')
    const { default: App } = await import('../src/App.jsx')
    render(<App />)

    // ---- registro: solo con invitación del dueño ----
    // (si algún día se activa «Entrar con Google», el formulario de correo queda tras «Usar correo y contraseña»)
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Cargando' })).toBeNull(), T)
    const useEmail = screen.queryByRole('button', { name: /Usar correo y contraseña/ })
    if (useEmail) fireEvent.click(useEmail)
    fireEvent.click(await screen.findByText('¿No tienes cuenta? Regístrate', {}, T))
    expect(screen.getByText('Crear cuenta', { selector: 'h2' })).toBeTruthy()

    const fillAndSubmit = async (mail) => {
      fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: mail } })
      fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: c.password } })
      fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }))
      expect(await screen.findByText('Crear cuenta nueva')).toBeTruthy() // confirmación del correo
      fireEvent.click(screen.getByRole('button', { name: 'Sí, crear cuenta' }))
    }

    // 1) un desconocido (no está en la lista) NO puede crear cuenta
    await fillAndSubmit(`lt_noinv_${suffix}@${c.domain}`)
    expect(await screen.findByText(/no está en la lista de la familia/, {}, T)).toBeTruthy()
    expect(screen.queryByText('¡Bienvenido a FamilyMarket!')).toBeNull()

    // 2) el dueño lo invita (con contraseña) y entonces sí puede
    const owner = (await apiClient(0)).client
    const invited = await owner.rpc('admin_invite_emails', { p_emails: [email], p_password_ok: true })
    expect(invited.error).toBeNull()
    expect(invited.data.added).toBe(1)
    await fillAndSubmit(email)

    // ---- elegir nombre ----
    expect(await screen.findByText('¡Bienvenido a FamilyMarket!', {}, T)).toBeTruthy()
    const nameInput = screen.getByLabelText('Nombre de usuario')
    const submit = screen.getByRole('button', { name: 'Comenzar a jugar' })

    fireEvent.change(nameInput, { target: { value: 'a!' } })
    fireEvent.click(submit)
    expect(await screen.findByText(/Usa de 3 a 20 caracteres/)).toBeTruthy()

    fireEvent.change(nameInput, { target: { value: 'plemecho' } }) // ya existe (en minúsculas)
    fireEvent.click(submit)
    expect(await screen.findByText('Este nombre ya está en uso', {}, T)).toBeTruthy()

    fireEvent.change(nameInput, { target: { value: username } })
    fireEvent.click(submit)

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
    await check.auth.signInWithPassword({ email, password: c.password })
    const { data: row } = await check.from('profiles').select('tour_completed_at, balance').single()
    expect(row.tour_completed_at).not.toBeNull()
    expect(Number(row.balance)).toBe(1000)

    // aparece en el ranking
    fireEvent.click(screen.getByRole('link', { name: /Ranking/ }))
    expect((await screen.findAllByText(username, {}, T)).length).toBeGreaterThan(0)

    // ---- salir ----
    fireEvent.click(screen.getByLabelText('Cerrar sesión'))
    expect(await screen.findByText('Iniciar sesión', { selector: 'h2' }, T)).toBeTruthy()

    // ---- contraseña incorrecta ----
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: email } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'incorrecta123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByText('Correo o contraseña incorrectos.', {}, T)).toBeTruthy()

    // ---- entrar bien ----
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: c.password } })
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(|AuthApiError|Invalid login/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
  }, 240000)
})
