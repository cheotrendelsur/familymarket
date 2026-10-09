// E2E del alta de un jugador NUEVO: registro -> nombre de usuario -> juego -> salir -> entrar.
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { creds, goto } from './helpers'
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

    // ---- registro ----
    expect(await screen.findByText('Iniciar sesión', { selector: 'h2' }, T)).toBeTruthy()
    fireEvent.click(screen.getByText('¿No tienes cuenta? Regístrate'))
    expect(screen.getByText('Crear cuenta', { selector: 'h2' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: email } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: c.password } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }))
    expect(await screen.findByText('Crear cuenta nueva')).toBeTruthy() // confirmación del correo
    fireEvent.click(screen.getByRole('button', { name: 'Sí, crear cuenta' }))

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

    // ---- ya dentro del juego ----
    expect(await screen.findByLabelText('Buscar mercados', {}, T)).toBeTruthy()
    expect(await screen.findByText(`@${username}`, {}, T)).toBeTruthy()
    expect(screen.getByLabelText('Saldo disponible').textContent).toContain('1,000.00')

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
