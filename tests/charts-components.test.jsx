// Componentes de gráficas con datos con la FORMA REAL del servidor (numéricos como texto, fechas con microsegundos y +00):
// cada cambio de filtro vuelve a pedir el dato, no queda el esqueleto, y una gráfica rota no tira toda la pantalla.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = []
let failNext = false
const NOW = Date.now()
const ago = (min) => new Date(NOW - min * 60000).toISOString().replace('Z', '+00:00')
const pgTs = (min) => new Date(NOW - min * 60000).toISOString().replace('T', ' ').replace('Z', '123+00') // «2026-10-10 14:15:26.788123+00»

const DATA = {
  get_market_history: () => [
    { created_at: pgTs(300), yes_price: '0.500000', no_price: '0.500000' },
    { created_at: pgTs(120), yes_price: '0.431200', no_price: '0.568800' },
    { created_at: pgTs(10), yes_price: '0.470000', no_price: '0.530000' },
  ],
  get_group_history: () => [
    { market_id: 'a', created_at: ago(200), yes_price: '0.333333' },
    { market_id: 'b', created_at: ago(200), yes_price: '0.333333' },
    { market_id: 'a', created_at: ago(30), yes_price: '0.45' },
    { market_id: 'b', created_at: ago(30), yes_price: '0.25' },
  ],
  get_networth_race: () => [
    { user_id: 'u1', username: 'Ana', taken_at: ago(400), net_worth: '1000.0000' },
    { user_id: 'u2', username: 'Beto', taken_at: ago(400), net_worth: '1000.0000' },
    { user_id: 'u1', username: 'Ana', taken_at: ago(20), net_worth: '1042.5000' },
    { user_id: 'u2', username: 'Beto', taken_at: ago(20), net_worth: '951.2000' },
  ],
  get_player_networth: () => [
    { taken_at: ago(400), cash: '1000.0000', positions: '0.0000', net_worth: '1000.0000' },
    { taken_at: ago(90), cash: '800.0000', positions: '230.5000', net_worth: '1030.5000' },
  ],
}

vi.mock('../src/lib/api', () => ({
  rpc: vi.fn(async (name, args) => {
    calls.push([name, args])
    if (failNext) {
      failNext = false
      throw new Error('sin red')
    }
    return DATA[name](args)
  }),
}))

const T = { timeout: 8000 }
beforeEach(() => {
  calls.length = 0
  failNext = false
})

describe('PriceChart / GroupChart / NetWorthChart / PortfolioChart', () => {
  it('mercado: cada filtro vuelve a pedir el historial con su ventana y no queda el esqueleto', async () => {
    const { PriceChart } = await import('../src/components/PriceCharts')
    const { container } = render(<PriceChart marketId="m1" currentYes={0.47} live />)
    await waitFor(() => expect(calls.length).toBe(1), T)
    expect(calls[0][1].p_since).toBeNull() // «Todo»
    await waitFor(() => expect(container.querySelector('.skeleton')).toBeNull(), T)

    fireEvent.click(screen.getByRole('tab', { name: '1H' }))
    await waitFor(() => expect(calls.length).toBe(2), T) // pedido AL INSTANTE, sin esperar al refresco automático
    expect(typeof calls[1][1].p_since).toBe('string')
    expect(Math.abs(Date.parse(calls[1][1].p_since) - (Date.now() - 3600e3))).toBeLessThan(5000)

    fireEvent.click(screen.getByRole('tab', { name: '6H' }))
    fireEvent.click(screen.getByRole('tab', { name: '1D' }))
    await waitFor(() => expect(calls.length).toBe(4), T)
    await waitFor(() => expect(screen.queryByText('Cargando…')).toBeNull(), T)
    expect(container.querySelector('.skeleton')).toBeNull()
    expect(screen.queryByText(/No se pudo/)).toBeNull()
  })

  it('si el servidor falla muestra el aviso con «Reintentar» y se recupera', async () => {
    failNext = true
    const { PriceChart } = await import('../src/components/PriceCharts')
    render(<PriceChart marketId="m2" currentYes={0.5} live={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar' }, T))
    await waitFor(() => expect(screen.queryByText('No se pudo cargar el gráfico')).toBeNull(), T)
  })

  it('mercado múltiple: pide el historial del grupo por rango', async () => {
    const { GroupChart } = await import('../src/components/PriceCharts')
    render(<GroupChart groupId="g1" options={[{ id: 'a', question: 'Papá' }, { id: 'b', question: 'Mamá' }]} live />)
    await waitFor(() => expect(calls.some((c) => c[0] === 'get_group_history')).toBe(true), T)
    fireEvent.click(screen.getByRole('tab', { name: '6H' }))
    await waitFor(() => expect(calls.filter((c) => c[0] === 'get_group_history').length).toBe(2), T)
    expect(screen.queryByText(/No se pudo/)).toBeNull()
  })

  it('carrera de patrimonio: cada filtro vuelve a pedir la carrera', async () => {
    const { default: NetWorthChart } = await import('../src/components/NetWorthChart')
    const leaderboard = [
      { user_id: 'u1', username: 'Ana', net_worth: 1050, rank: 1 },
      { user_id: 'u2', username: 'Beto', net_worth: 950, rank: 2 },
    ]
    render(<NetWorthChart leaderboard={leaderboard} meId="u1" />)
    await waitFor(() => expect(calls.length).toBe(1), T)
    fireEvent.click(screen.getByRole('tab', { name: '1D' }))
    await waitFor(() => expect(calls.length).toBe(2), T)
    expect(typeof calls[1][1].p_since).toBe('string')
    expect(calls[1][1].p_max_points).toBe(80)
    expect(screen.queryByText(/No se pudo/)).toBeNull()
  })

  it('portafolio: pide la serie del jugador y resume cuánto subió', async () => {
    const { default: PortfolioChart } = await import('../src/components/PortfolioChart')
    render(<PortfolioChart userId="u1" title="Mi portafolio" liveNet={1100} liveCash={700} initial={1000} />)
    await waitFor(() => expect(calls.length).toBe(1), T)
    expect(calls[0][0]).toBe('get_player_networth')
    expect(calls[0][1].p_user_id).toBe('u1')
    const change = await screen.findByTestId('portfolio-change', {}, T)
    await waitFor(() => expect(change.textContent).toMatch(/\+\$100\.00 \(\+10\.0%\)\s*desde que empezó/), T)

    fireEvent.click(screen.getByRole('tab', { name: '6H' }))
    await waitFor(() => expect(calls.length).toBe(2), T)
    await waitFor(() => expect(screen.getByTestId('portfolio-change').textContent).toMatch(/en este rango/), T)
  })

  it('una gráfica que falla no tira toda la pantalla', async () => {
    const { ChartBoundary } = await import('../src/components/PriceCharts')
    const Boom = () => {
      throw new Error('dato raro')
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <p>El resto de la pantalla sigue</p>
        <ChartBoundary>
          <Boom />
        </ChartBoundary>
      </div>
    )
    expect(screen.getByText('No se pudo mostrar el gráfico')).toBeTruthy()
    expect(screen.getByText('El resto de la pantalla sigue')).toBeTruthy()
    errorSpy.mockRestore()
  })
})
