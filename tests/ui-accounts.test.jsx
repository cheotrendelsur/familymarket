// Cuentas (pedir ayuda, restablecer, deshabilitar, eliminar, cambiar contraseña), apertura programada y premio por
// mercado sorpresa, en modo demo (no toca la base real).
import { describe, expect, it, vi } from 'vitest'
import { consoleErrors } from './setup'

const T = { timeout: 15000 }

async function boot(path) {
  vi.resetModules()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.history.pushState({}, '', path)
  const rtl = await import('@testing-library/react')
  const { default: App } = await import('../src/App.jsx')
  rtl.render(<App />)
  return rtl
}

describe('Recuperar el acceso', () => {
  it('quien olvidó su usuario o contraseña pide ayuda desde la pantalla de acceso (sin crear otra cuenta)', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/auth?mock=1&signedout=1')
    fireEvent.click(await screen.findByRole('button', { name: /¿Olvidaste tu usuario o tu contraseña\?/ }, T))
    expect(await screen.findByText(/No crees otra cuenta/, {}, T)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Tu nombre \(el del juego o tu nombre real\)/), { target: { value: 'Tomi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Pedir ayuda' }))
    await waitFor(() => expect(screen.getByText(/Cheche vio tu solicitud/)).toBeTruthy(), T)
    cleanup()
  })

  it('al registrarse con un nombre parecido a uno que ya existe se avisa para no duplicar la cuenta', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/auth?mock=1&signedout=1&codigo=DEMO2026')
    fireEvent.change(await screen.findByLabelText('Tu nombre de jugador', {}, T), { target: { value: 'Cheche_2' } })
    await waitFor(() => expect(screen.getByText(/Ya hay un jugador parecido/)).toBeTruthy(), T)
    expect(screen.getByRole('alert').textContent).toMatch(/Cheche/)
    expect(screen.getByRole('button', { name: 'Pedir ayuda' })).toBeTruthy()
    cleanup()
  })

  it('el dueño ve la solicitud, restablece con un toque y copia el mensaje con usuario y contraseña', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Gente' }, T))
    expect(await screen.findByText(/Piden ayuda \(1\)/, {}, T)).toBeTruthy()
    await screen.findByText('Tomas_christiansen', {}, T) // la lista ya cargó
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer a MariChris' }))
    expect(await screen.findByRole('button', { name: 'Restablecer contraseña' }, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
    await waitFor(() => expect(screen.getByTestId('reset-password')).toBeTruthy(), T)
    expect(screen.getByTestId('reset-username').textContent).toBe('MariChris')
    expect(screen.getByTestId('reset-password').textContent).toMatch(/^[a-z]{6}[2-9]{2}$/) // fácil de dictar
    expect(screen.getByText(/ahora entra con su nombre de usuario/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copiar mensaje para WhatsApp/ })).toBeTruthy()
    cleanup()
  })

  it('el jugador cambia su propia contraseña desde Portafolio → Mi cuenta', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/portfolio?mock=1&role=player')
    expect(await screen.findByText('Tu usuario (con este entras)', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Cambiar mi contraseña/ }))
    fireEvent.change(await screen.findByLabelText('Contraseña nueva', {}, T), { target: { value: 'nueva-clave' } })
    fireEvent.change(screen.getByLabelText('Repítela'), { target: { value: 'otra-cosa' } })
    expect(screen.getByRole('button', { name: 'Guardar mi contraseña' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Repítela'), { target: { value: 'nueva-clave' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar mi contraseña' }))
    await waitFor(() => expect(screen.queryByLabelText('Contraseña nueva')).toBeNull(), T)
    cleanup()
  })
})

describe('Dueño · deshabilitar y eliminar jugadores', () => {
  it('busca, deshabilita (sale del ranking), rehabilita y elimina para siempre', async () => {
    const { screen, fireEvent, waitFor, within, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Gente' }, T))
    await screen.findByText('Yudrexi', {}, T) // la lista ya cargó
    fireEvent.change(screen.getByLabelText('Buscar jugador'), { target: { value: 'plemecho' } })
    await waitFor(() => expect(screen.queryByText('Yudrexi')).toBeNull(), T)

    fireEvent.click(screen.getByText('Plemecho'))
    fireEvent.click(await screen.findByRole('button', { name: /Deshabilitar jugador/ }, T))
    fireEvent.click(await screen.findByRole('button', { name: 'Deshabilitar' }, T)) // confirmación
    await waitFor(() => expect(screen.getByText(/Deshabilitados \(1\)/)).toBeTruthy(), T)
    expect(screen.getByText('Plemecho_off')).toBeTruthy()

    // rehabilitar
    fireEvent.change(screen.getByLabelText('Buscar jugador'), { target: { value: 'plemecho' } })
    fireEvent.click(screen.getByText('Plemecho_off'))
    fireEvent.click(await screen.findByRole('button', { name: /Rehabilitar/ }, T))
    await waitFor(() => expect(screen.queryByText(/Deshabilitados \(1\)/)).toBeNull(), T)
    expect(screen.getByText('Plemecho')).toBeTruthy()

    // deshabilitar otra vez (la fila sigue abierta) y eliminar definitivamente (solo se puede después de deshabilitar)
    fireEvent.click(await screen.findByRole('button', { name: /Deshabilitar jugador/ }, T))
    fireEvent.click(await screen.findByRole('button', { name: 'Deshabilitar' }, T))
    await waitFor(() => expect(screen.getByText('Plemecho_off')).toBeTruthy(), T)
    fireEvent.click(screen.getByText('Plemecho_off'))
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar para siempre/ }, T))
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar definitivamente' }, T))
    await waitFor(() => expect(screen.queryByText('Plemecho_off')).toBeNull(), T)
    void within
    cleanup()
  })
})

describe('Apertura programada', () => {
  it('los jugadores ven el mercado como «Próximamente» y no pueden apostar hasta que abra', async () => {
    const { screen, cleanup } = await boot('/?mock=1&role=player')
    expect(await screen.findByText('🗓️ Próximamente', {}, T)).toBeTruthy()
    const title = screen.getByText('¿Cantamos cumpleaños antes de las 8 pm?')
    const card = title.closest('article')
    expect(card.textContent).toMatch(/Abre en/)
    expect(card.querySelector('button')).toBeNull() // sin botones Sí / No
    cleanup()

    const page = await boot('/m/soonopen?mock=1&role=player')
    expect(await page.screen.findByText('Todavía no abre', {}, T)).toBeTruthy()
    expect(page.screen.queryByRole('button', { name: /Comprar/ })).toBeNull()
    page.cleanup()
  })

  it('quien lo creó lo abre ya desde «Hoy», y al crear uno nuevo puede programar la apertura', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/admin?mock=1&role=owner')
    expect(await screen.findByText('Próximos a abrir', {}, T)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ya' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir ahora' }, T))
    await waitFor(() => expect(screen.queryByText('Próximos a abrir')).toBeNull(), T)

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.change(await screen.findByPlaceholderText('¿Lloverá mañana en Margarita?', {}, T), { target: { value: '¿Abrimos el regalo a las 6 pm?' } })
    expect(screen.getByText(/Se abre en el momento en que lo publicas/)).toBeTruthy() // por defecto: al crearse
    fireEvent.click(screen.getByRole('button', { name: 'En 1 hora' }))
    expect(screen.getByText(/Hasta entonces los jugadores lo ven como «Próximamente»/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar mercado' }))
    expect(await screen.findByText(/Mercado publicado/, {}, T)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Mercados' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Próximos/ }, T))
    expect(await screen.findByText('¿Abrimos el regalo a las 6 pm?', { selector: 'h3' }, T)).toBeTruthy()
    cleanup()
  })
})

describe('Premio por mercado sorpresa', () => {
  it('quien no pudo participar ve la apuesta que le ocultaron y el dinero que ganó, y cierra la tarjeta', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/?mock=1&role=player&reward=1')
    const card = await screen.findByTestId('reward-card', {}, T)
    expect(screen.getByLabelText('¡Premio sorpresa!')).toBeTruthy()
    expect(card.textContent).toMatch(/La apuesta que te ocultaron/i)
    expect(screen.getByText('¿Quién llorará primero en la boda?')).toBeTruthy() // la apuesta que le ocultaron
    expect(card.textContent).toMatch(/Resultado: ganó «Sí»/)
    expect(card.textContent).toMatch(/Se movieron \$1,000\.00 en esa apuesta\. Te tocó el 2 % de ese dinero\./)
    await waitFor(() => expect(screen.getByTestId('reward-amount').textContent).toBe('+$20.00'), { timeout: 8000 }) // el dinero sube animado
    fireEvent.click(screen.getByRole('button', { name: /¡Genial!/ }))
    await waitFor(() => expect(screen.queryByTestId('reward-card')).toBeNull(), T)
    cleanup()
  })

  it('el dueño ajusta el porcentaje y al ocultar un mercado se avisa del premio', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Más' }, T))
    fireEvent.click(await screen.findByRole('button', { name: /Premio por mercado sorpresa/ }, T))
    expect(await screen.findByLabelText('Porcentaje del premio', {}, T)).toBeTruthy()
    expect(screen.getByLabelText('Porcentaje del premio').value).toBe('2')
    expect(screen.getByLabelText('Máximo por persona').value).toBe('40')
    // ejemplos con la fórmula: $3000 apostados y 1 persona oculta = 2 % = $60, pero el tope es $40
    expect(screen.getByLabelText('Ejemplos').textContent).toMatch(/\$40\.00/)
    fireEvent.change(screen.getByLabelText('Porcentaje del premio'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar premio' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar premio' }).disabled).toBe(true), T)

    fireEvent.click(screen.getByRole('button', { name: 'Crear' }))
    fireEvent.click(await screen.findByRole('button', { name: /Más opciones/ }, T))
    fireEvent.click(await screen.findByRole('button', { name: 'Ricky' }, T))
    expect((await screen.findByRole('status', {}, T)).textContent).toMatch(/3 % del dinero apostado/)
    expect(screen.getByRole('status').textContent).toMatch(/máximo de \$40/)

    const bad = consoleErrors.filter((m) => /Warning|Error|Uncaught|Cannot|undefined/i.test(m) && !/act\(/.test(m))
    expect(bad, bad.join('\n')).toEqual([])
    cleanup()
  })
})
