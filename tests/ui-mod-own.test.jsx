// Un moderador solo ve y maneja (cerrar, editar, resolver) los mercados que ÉL creó; el dueño maneja todos.
// Modo demo: en los datos de ejemplo «rain» lo creó el usuario actual y «sleep» lo creó otra persona.
import { describe, expect, it, vi } from 'vitest'

const T = { timeout: 15000 }
const MINE = '¿Lloverá el sábado en Margarita?'
const OTHERS = '¿Papá se queda dormido en la playa antes de las 3 pm?'

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

describe('Moderador · solo lo que creó', () => {
  it('en Admin → Mercados solo aparecen sus mercados', async () => {
    const { screen, fireEvent, cleanup } = await boot('/admin?mock=1&role=mod')
    fireEvent.click(await screen.findByRole('button', { name: 'Mercados' }, T))
    expect(await screen.findByText(MINE, { selector: 'h3' }, T)).toBeTruthy()
    expect(screen.queryByText(OTHERS, { selector: 'h3' })).toBeNull()
    expect(screen.getByText(/solo los mercados que tú creaste/)).toBeTruthy()
    cleanup()
  })

  it('en la pantalla de un mercado: ve los atajos en el suyo y no en el ajeno', async () => {
    const own = await boot('/m/rain?mock=1&role=mod')
    expect(await own.screen.findByLabelText('Atajos de administración', {}, T)).toBeTruthy()
    own.cleanup()

    const other = await boot('/m/sleep?mock=1&role=mod')
    expect(await other.screen.findByText(OTHERS, {}, T)).toBeTruthy()
    expect(other.screen.queryByLabelText('Atajos de administración')).toBeNull()
    other.cleanup()
  })

  it('el dueño ve y maneja todos los mercados', async () => {
    const { screen, fireEvent, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Mercados' }, T))
    expect(await screen.findByText(MINE, { selector: 'h3' }, T)).toBeTruthy()
    expect(await screen.findByText(OTHERS, { selector: 'h3' }, T)).toBeTruthy()
    expect(screen.queryByText(/solo los mercados que tú creaste/)).toBeNull()
    cleanup()

    const m = await boot('/m/sleep?mock=1&role=owner')
    expect(await m.screen.findByLabelText('Atajos de administración', {}, T)).toBeTruthy()
    m.cleanup()
  })
})
