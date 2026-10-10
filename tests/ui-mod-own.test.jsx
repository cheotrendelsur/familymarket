// Un moderador puede CERRAR las apuestas y RESOLVER cualquier mercado (decisión final), pero EDITAR solo los que él creó;
// el dueño maneja todo. Modo demo: en los datos de ejemplo «rain» lo creó el usuario actual y «sleep» lo creó otra persona.
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

describe('Moderador · cierra y resuelve todo, edita lo suyo', () => {
  it('en Admin → Mercados ve los suyos y los de los demás, con el aviso de qué puede hacer', async () => {
    const { screen, fireEvent, cleanup } = await boot('/admin?mock=1&role=mod')
    fireEvent.click(await screen.findByRole('button', { name: 'Mercados' }, T))
    expect(await screen.findByText(MINE, { selector: 'h3' }, T)).toBeTruthy()
    expect(await screen.findByText(OTHERS, { selector: 'h3' }, T)).toBeTruthy()
    expect(screen.getByText(/cerrar las apuestas y decidir el resultado de cualquier mercado/)).toBeTruthy()
    cleanup()
  })

  it('en un mercado AJENO tiene los botones de resolver y cerrar, pero no editar', async () => {
    const other = await boot('/m/sleep?mock=1&role=mod')
    expect(await other.screen.findByLabelText('Atajos de administración', {}, T)).toBeTruthy()
    expect(other.screen.getByRole('button', { name: /Gana Sí/ })).toBeTruthy()
    expect(other.screen.getByRole('button', { name: /Gana No/ })).toBeTruthy()
    expect(other.screen.getByRole('button', { name: /Cerrar apuestas/ })).toBeTruthy()
    expect(other.screen.queryByRole('button', { name: /Editar/ })).toBeNull()
    expect(other.screen.getByText(/lo creó otra persona/)).toBeTruthy()
    other.cleanup()
  })

  it('en un mercado PROPIO además puede editar', async () => {
    const own = await boot('/m/rain?mock=1&role=mod')
    expect(await own.screen.findByLabelText('Atajos de administración', {}, T)).toBeTruthy()
    expect(own.screen.getByRole('button', { name: /Editar/ })).toBeTruthy()
    expect(own.screen.queryByText(/lo creó otra persona/)).toBeNull()
    own.cleanup()
  })

  it('puede cerrar las apuestas de un mercado ajeno desde el panel', async () => {
    const { screen, fireEvent, waitFor, cleanup } = await boot('/m/sleep?mock=1&role=mod')
    fireEvent.click(await screen.findByRole('button', { name: /Cerrar apuestas/ }, T))
    // aparece el cuadro de confirmación: ahora hay dos botones «Cerrar apuestas» (el atajo y el de confirmar, que va al final)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Cerrar apuestas' }).length).toBeGreaterThan(1), T)
    const buttons = screen.getAllByRole('button', { name: 'Cerrar apuestas' })
    fireEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(screen.queryByRole('button', { name: /Cerrar apuestas/ })).toBeNull(), T)
    cleanup()
  })

  it('el dueño ve y maneja todos los mercados, sin avisos de moderador', async () => {
    const { screen, fireEvent, cleanup } = await boot('/admin?mock=1&role=owner')
    fireEvent.click(await screen.findByRole('button', { name: 'Mercados' }, T))
    expect(await screen.findByText(MINE, { selector: 'h3' }, T)).toBeTruthy()
    expect(await screen.findByText(OTHERS, { selector: 'h3' }, T)).toBeTruthy()
    expect(screen.queryByText(/Como moderador/)).toBeNull()
    cleanup()

    const m = await boot('/m/sleep?mock=1&role=owner')
    expect(await m.screen.findByLabelText('Atajos de administración', {}, T)).toBeTruthy()
    expect(m.screen.getByRole('button', { name: /Editar/ })).toBeTruthy()
    m.cleanup()
  })
})
