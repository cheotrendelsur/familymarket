import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react'
import { rpc } from '../lib/api'
import { groupMarkets } from '../lib/markets'
import { noPrice, yesPrice } from '../lib/trading'
import { dateTime, friendlyError, money } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useToggleSet } from '../hooks/useToggleSet'
import { useConfirm } from '../components/ConfirmDialog'
import GroupAccordion from '../components/GroupAccordion'
import { Spinner } from '../components/PageLoader'

const ACTION_LABELS = {
  create_market: 'Creó un mercado',
  resolve_market: 'Resolvió un mercado',
  delete_market: 'Anuló un mercado',
  update_balance: 'Ajustó un saldo',
  archive_and_reset: 'Archivó y reinició la partida',
}

const inputClass =
  'w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition'

function Notice({ tone, children }) {
  const styles = tone === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-800'
  const Icon = tone === 'error' ? AlertCircle : CheckCircle
  return (
    <div className={`p-4 border rounded-lg flex items-start gap-3 ${styles}`}>
      <Icon size={20} className="flex-shrink-0 mt-0.5" />
      <p className="text-sm flex-1">{children}</p>
    </div>
  )
}

function AdminMarketCard({ market, onResolve, onDelete }) {
  return (
    <div
      className={`border-2 rounded-xl p-5 transition-all ${
        market.closed ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200 hover:border-polyblue hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 text-lg mb-1 leading-snug">{market.question}</h3>
          {market.description && <p className="text-sm text-gray-600 leading-relaxed">{market.description}</p>}
          {market.target_users?.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">👻 Oculto para {market.target_users.length} jugador(es)</p>
          )}
        </div>
        {market.closed && (
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-sm border-2 ${
              market.outcome === 'YES' ? 'bg-emerald-100 text-polygreen border-polygreen' : 'bg-rose-100 text-polyred border-polyred'
            }`}
          >
            {market.outcome === 'YES' ? <CheckCircle size={18} /> : <XCircle size={18} />}
            GANÓ {market.outcome}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-emerald-50 rounded-lg p-3 border-2 border-emerald-200">
          <div className="text-xs font-semibold text-gray-600 mb-1">YES</div>
          <div className="text-2xl font-bold text-polygreen">{(yesPrice(market) * 100).toFixed(1)}¢</div>
          <div className="text-xs text-gray-600 mt-1">Pool: {Number(market.yes_pool).toFixed(2)}</div>
        </div>
        <div className="bg-rose-50 rounded-lg p-3 border-2 border-rose-200">
          <div className="text-xs font-semibold text-gray-600 mb-1">NO</div>
          <div className="text-2xl font-bold text-polyred">{(noPrice(market) * 100).toFixed(1)}¢</div>
          <div className="text-xs text-gray-600 mt-1">Pool: {Number(market.no_pool).toFixed(2)}</div>
        </div>
      </div>

      {!market.closed ? (
        <div className="pt-4 border-t-2 border-gray-200 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => onResolve(market, 'YES')}
              className="flex items-center justify-center gap-2 bg-polygreen hover:bg-green-700 text-white py-3 rounded-xl font-bold shadow-lg shadow-green-500/20"
            >
              <CheckCircle size={20} strokeWidth={2.5} /> Gana YES
            </button>
            <button
              onClick={() => onResolve(market, 'NO')}
              className="flex items-center justify-center gap-2 bg-polyred hover:bg-red-700 text-white py-3 rounded-xl font-bold shadow-lg shadow-red-500/20"
            >
              <XCircle size={20} strokeWidth={2.5} /> Gana NO
            </button>
          </div>
          <button
            onClick={() => onDelete(market)}
            className="w-full flex items-center justify-center gap-2 bg-gray-50 hover:bg-red-50 text-gray-500 hover:text-red-600 border-2 border-gray-200 hover:border-red-200 py-2.5 rounded-xl font-bold"
          >
            <Trash2 size={18} strokeWidth={2.5} /> Anular y eliminar mercado
          </button>
        </div>
      ) : (
        <div className="text-xs text-gray-500 mt-4 pt-4 border-t-2 border-gray-200 text-center">
          Resuelto el {dateTime(market.resolved_at)}
        </div>
      )}
    </div>
  )
}

export default function AdminPage() {
  const { profile } = useAuth()
  const { markets, marketsLoaded, refreshMarkets, config } = useGame()
  const confirm = useConfirm()

  const [players, setPlayers] = useState([])
  const [form, setForm] = useState({ question: '', description: '', image_url: '' })
  const [isMultiple, setIsMultiple] = useState(false)
  const [groupTopic, setGroupTopic] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [hiddenFrom, setHiddenFrom] = useState([])
  const [createLoading, setCreateLoading] = useState(false)
  const [createMsg, setCreateMsg] = useState(null)

  const [selectedUserId, setSelectedUserId] = useState('')
  const [balanceAmount, setBalanceAmount] = useState('')
  const [balanceLoading, setBalanceLoading] = useState(false)

  const [resetTitle, setResetTitle] = useState('')
  const [resetWord, setResetWord] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const [openTopics, toggleTopic] = useToggleSet()

  const isAdmin = !!profile?.is_admin

  const [actions, setActions] = useState([])

  const fetchPlayers = useCallback(async () => {
    const data = await rpc('admin_list_players')
    setPlayers(data || [])
    const log = await rpc('admin_recent_actions', { p_limit: 15 })
    setActions(log || [])
  }, [])

  useEffect(() => {
    if (isAdmin) fetchPlayers().catch(() => {})
  }, [isAdmin, fetchPlayers])

  const sorted = useMemo(
    () => [...markets].sort((a, b) => Number(a.closed) - Number(b.closed)),
    [markets]
  )
  const { particular, groups } = useMemo(() => groupMarkets(sorted), [sorted])

  const handleCreate = async (e) => {
    e.preventDefault()
    setCreateMsg(null)
    setCreateLoading(true)
    try {
      const common = {
        p_description: form.description.trim() || null,
        p_image_url: form.image_url.trim() || null,
        p_target_users: hiddenFrom.length > 0 ? hiddenFrom : null,
      }
      if (isMultiple) {
        const data = await rpc('admin_create_market_group', {
          p_topic: groupTopic.trim(),
          p_options: options,
          ...common,
        })
        setCreateMsg({ tone: 'ok', text: `✅ ${data.created} submercados creados bajo el tópico: ${groupTopic.trim()}` })
      } else {
        await rpc('admin_create_market', { p_question: form.question.trim(), p_group_topic: null, ...common })
        setCreateMsg({ tone: 'ok', text: '✅ Mercado creado exitosamente' })
      }
      setForm({ question: '', description: '', image_url: '' })
      setGroupTopic('')
      setOptions(['', ''])
      setHiddenFrom([])
      setIsMultiple(false)
      refreshMarkets()
      fetchPlayers().catch(() => {})
    } catch (err) {
      setCreateMsg({ tone: 'error', text: friendlyError(err) })
    } finally {
      setCreateLoading(false)
    }
  }

  const handleResolve = async (market, outcome) => {
    const ok = await confirm({
      title: `Resolver como ${outcome}`,
      message: `${market.question}\n\nEsta acción es IRREVERSIBLE: pagará $1.00 por acción a los ganadores de ${outcome} y cerrará el mercado.`,
      confirmText: `Gana ${outcome}`,
      tone: 'danger',
    })
    if (!ok) return
    try {
      const data = await rpc('resolve_market', { p_market_id: market.id, p_outcome: outcome })
      toast.success(`Resuelto. Ganó ${outcome} · Pagado ${money(data.total_paid)} a ${data.winners} jugador(es)`, { duration: 6000 })
      refreshMarkets()
      fetchPlayers().catch(() => {})
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const handleDelete = async (market) => {
    const ok = await confirm({
      title: 'Anular y borrar mercado',
      message: `"${market.question}"\n\n• Devuelve a los jugadores el dinero invertido.\n• Revierte las ganancias de quienes vendieron antes.\n• Borra todo su historial.\n\nEs como si el mercado nunca hubiera existido. Es IRREVERSIBLE.`,
      confirmText: 'Anular mercado',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const data = await rpc('delete_market_and_refund', { p_market_id: market.id })
      toast.success(
        `Mercado anulado · ${data.users} jugador(es) ajustados${data.clamped_users ? ` (${data.clamped_users} con saldo insuficiente para devolver ganancias)` : ''}`,
        { duration: 6000 }
      )
      refreshMarkets()
      fetchPlayers().catch(() => {})
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const handleBalance = async (type) => {
    const value = parseFloat(String(balanceAmount).replace(',', '.'))
    if (!selectedUserId || !(value > 0)) {
      toast.error('Selecciona un jugador e ingresa un monto mayor a 0')
      return
    }
    const player = players.find((p) => p.id === selectedUserId)
    const ok = await confirm({
      title: type === 'add' ? 'Agregar fondos' : 'Quitar fondos',
      message: `${type === 'add' ? 'Agregar' : 'Quitar'} ${money(value)} a ${player?.username || 'este jugador'}.`,
      confirmText: type === 'add' ? 'Agregar' : 'Quitar',
    })
    if (!ok) return
    setBalanceLoading(true)
    try {
      await rpc('admin_update_balance', { p_user_id: selectedUserId, p_amount: type === 'add' ? value : -value })
      toast.success('Saldo actualizado')
      setBalanceAmount('')
      setSelectedUserId('')
      fetchPlayers().catch(() => {})
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    } finally {
      setBalanceLoading(false)
    }
  }

  const handleArchiveReset = async () => {
    const title = resetTitle.trim() || `FamilyMarket · ${new Date().toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })}`
    const ok = await confirm({
      title: 'Archivar y reiniciar la partida',
      message: `Se guardará una copia completa en "Recuerdos" (${title}) y luego TODO volverá a cero: mercados, acciones y operaciones se borran y cada jugador vuelve a ${money(config.initial_balance)}.\n\nLas cuentas y nombres de usuario se conservan.`,
      confirmText: 'Archivar y reiniciar',
      tone: 'danger',
    })
    if (!ok) return
    setResetLoading(true)
    try {
      const slug = `juego-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6)}`
      const data = await rpc('admin_archive_and_reset', { p_title: title, p_slug: slug })
      toast.success(`Partida archivada (${data.players} jugadores, ${data.markets} mercados). ¡Listos para empezar de cero!`, { duration: 7000 })
      setResetWord('')
      setResetTitle('')
      refreshMarkets()
      fetchPlayers().catch(() => {})
    } catch (err) {
      toast.error(friendlyError(err), { duration: 7000 })
    } finally {
      setResetLoading(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe px-4">
        <div className="text-center bg-white rounded-2xl p-8 border border-red-200 shadow-lg">
          <AlertCircle size={64} className="mx-auto text-red-500 mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso denegado</h2>
          <p className="text-gray-600">No tienes permisos de administrador</p>
        </div>
      </div>
    )
  }

  if (!marketsLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen-safe">
        <Spinner />
      </div>
    )
  }

  const pct = (config.fee_rate * 100).toFixed(0)

  return (
    <div className="min-h-screen-safe bg-polygray-bg px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="bg-gradient-to-r from-polyblue to-blue-600 rounded-2xl p-6 text-white shadow-xl">
          <h1 className="text-3xl font-bold mb-2">Panel de administración</h1>
          <p className="text-blue-100">
            Modelo CPMM · Liquidez {config.initial_liquidity}/{config.initial_liquidity} · Fee {pct}% · {config.daily_limit} movimientos/día
          </p>
        </div>

        {/* ============ CREAR MERCADO ============ */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-polyblue rounded-xl flex items-center justify-center shadow-lg">
              <Plus size={28} className="text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Crear nuevo mercado</h2>
              <p className="text-sm text-gray-600">Se inicializa con {config.initial_liquidity} tokens de liquidez en cada lado</p>
            </div>
          </div>

          {createMsg && (
            <div className="mb-4">
              <Notice tone={createMsg.tone}>{createMsg.text}</Notice>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-5">
            <div className="flex items-center justify-between bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div>
                <h3 className="font-bold text-gray-900">Mercado múltiple</h3>
                <p className="text-xs text-gray-500">Agrupa varias opciones bajo un mismo tema</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMultiple(!isMultiple)}
                aria-pressed={isMultiple}
                className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors shadow-inner ${isMultiple ? 'bg-polyblue' : 'bg-gray-300'}`}
              >
                <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${isMultiple ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>

            {isMultiple ? (
              <div className="space-y-4 bg-blue-50/50 p-5 rounded-xl border border-blue-100">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Tópico general * (Ej: ¿Quién comerá más?)</label>
                  <input type="text" value={groupTopic} onChange={(e) => setGroupTopic(e.target.value)} className={inputClass} required maxLength={120} />
                </div>
                <div className="space-y-3">
                  <label className="block text-sm font-bold text-gray-700">Opciones / participantes *</label>
                  {options.map((opt, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => setOptions(options.map((o, i) => (i === idx ? e.target.value : o)))}
                        placeholder={`Opción ${idx + 1} (Ej: Papá)`}
                        className={`${inputClass} flex-1`}
                        maxLength={200}
                        required
                      />
                      {options.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                          className="px-3 text-red-500 hover:bg-red-50 rounded-lg"
                          aria-label="Quitar opción"
                        >
                          <Trash2 size={22} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOptions([...options, ''])}
                    className="text-polyblue font-bold text-sm flex items-center gap-1 px-2 py-1 hover:bg-blue-100 rounded-lg"
                  >
                    <Plus size={18} /> Agregar otra opción
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Pregunta del mercado *</label>
                <input
                  type="text"
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  placeholder="¿Lloverá mañana en Margarita?"
                  className={inputClass}
                  required
                  maxLength={200}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Descripción (opcional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Contexto adicional sobre el mercado..."
                rows="3"
                maxLength={1000}
                className={`${inputClass} resize-none`}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">URL de imagen (opcional)</label>
              <input
                type="url"
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://example.com/image.jpg"
                className={inputClass}
              />
            </div>

            <div className="bg-gray-50 border-2 border-gray-200 rounded-xl p-4">
              <h3 className="font-bold text-gray-900 mb-2">👻 Filtro fantasma (lista negra)</h3>
              <p className="text-xs text-gray-600 mb-3 font-medium">
                Selecciona a quién quieres <b>OCULTARLE</b> este mercado. Si no seleccionas a nadie, será público para todos.
              </p>
              <div className="grid grid-cols-2 gap-3 max-h-56 overflow-y-auto p-1">
                {players.filter((p) => p.username).map((u) => {
                  const selected = hiddenFrom.includes(u.id)
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 cursor-pointer p-3 rounded-xl border-2 transition-all ${
                        selected ? 'bg-blue-50 border-polyblue shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={selected}
                        onChange={(e) =>
                          setHiddenFrom(e.target.checked ? [...hiddenFrom, u.id] : hiddenFrom.filter((id) => id !== u.id))
                        }
                      />
                      <div
                        className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                          selected ? 'bg-polyblue border-polyblue' : 'bg-gray-100 border-gray-300'
                        }`}
                      >
                        {selected && <Check size={16} className="text-white" strokeWidth={3} />}
                      </div>
                      <span className={`text-sm font-bold truncate ${selected ? 'text-polyblue' : 'text-gray-700'}`}>{u.username}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <button
              type="submit"
              disabled={createLoading}
              className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 shadow-lg shadow-blue-500/20"
            >
              {createLoading ? 'Creando mercado...' : isMultiple ? 'Crear mercados' : 'Crear mercado'}
            </button>
          </form>
        </div>

        {/* ============ EFECTIVO ============ */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-2xl">$</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Gestión de efectivo</h2>
              <p className="text-sm text-gray-600">Agrega o quita fondos a la cartera de los jugadores</p>
            </div>
          </div>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Jugador</label>
              <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className={`${inputClass} bg-white`}>
                <option value="">-- Elige un jugador --</option>
                {players.filter((p) => p.username).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} (saldo: {money(u.balance)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Monto (USD)</label>
              <input
                type="text"
                inputMode="decimal"
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                placeholder="Ej: 50.00"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleBalance('add')}
                disabled={balanceLoading || !selectedUserId || !balanceAmount}
                className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50"
              >
                <Plus size={20} strokeWidth={2.5} /> Agregar
              </button>
              <button
                onClick={() => handleBalance('subtract')}
                disabled={balanceLoading || !selectedUserId || !balanceAmount}
                className="flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-rose-500/20 disabled:opacity-50"
              >
                <Trash2 size={20} strokeWidth={2.5} /> Quitar
              </button>
            </div>
          </div>
        </div>

        {/* ============ LISTA DE MERCADOS ============ */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Todos los mercados ({markets.length})</h2>
          {markets.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No hay mercados creados todavía</p>
            </div>
          ) : (
            <div className="space-y-8">
              {particular.length > 0 && (
                <div>
                  <h3 className="text-xl font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Mercados particulares</h3>
                  <div className="space-y-4">
                    {particular.map((m) => (
                      <AdminMarketCard key={m.id} market={m} onResolve={handleResolve} onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              )}
              {groups.length > 0 && (
                <div>
                  <h3 className="text-xl font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Mercados múltiples</h3>
                  <div className="space-y-4">
                    {groups.map(([topic, list]) => (
                      <GroupAccordion
                        key={topic}
                        topic={topic}
                        count={list.length}
                        open={!!openTopics[topic]}
                        hintOpen="Ocultar submercados"
                        hintClosed="Toca para ver y resolver"
                        onToggle={() => toggleTopic(topic)}
                      >
                        {list.map((m) => (
                          <AdminMarketCard key={m.id} market={m} onResolve={handleResolve} onDelete={handleDelete} />
                        ))}
                      </GroupAccordion>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============ REGISTRO DE ACTIVIDAD ============ */}
        {actions.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Registro de actividad del admin</h2>
            <ul className="divide-y divide-gray-100 text-sm">
              {actions.map((a) => (
                <li key={a.id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-800">{ACTION_LABELS[a.action] || a.action}</span>
                    {a.detail?.question && <span className="text-gray-500"> · {a.detail.question}</span>}
                    {a.target_username && <span className="text-gray-500"> · {a.target_username}</span>}
                    {a.amount !== null && a.amount !== undefined && a.action !== 'create_market' && (
                      <span className="text-gray-500"> · {money(a.amount)}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{dateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ============ ZONA DE PELIGRO ============ */}
        <div className="bg-white rounded-2xl border-2 border-red-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-red-500 rounded-xl flex items-center justify-center shadow-lg">
              <Archive size={26} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Nueva partida</h2>
              <p className="text-sm text-gray-600">Archiva esta partida en “Recuerdos” y empieza de cero</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Título del recuerdo (opcional)</label>
              <input
                type="text"
                value={resetTitle}
                onChange={(e) => setResetTitle(e.target.value)}
                placeholder="FamilyMarket · Viaje a Margarita"
                className={inputClass}
                maxLength={80}
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Escribe <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">REINICIAR</span> para confirmar
              </label>
              <input type="text" value={resetWord} onChange={(e) => setResetWord(e.target.value)} className={inputClass} autoComplete="off" />
            </div>
            <button
              onClick={handleArchiveReset}
              disabled={resetLoading || resetWord.trim().toUpperCase() !== 'REINICIAR'}
              className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold text-lg disabled:opacity-40 shadow-lg shadow-red-500/20"
            >
              <Archive size={20} /> {resetLoading ? 'Archivando...' : 'Archivar y reiniciar partida'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
