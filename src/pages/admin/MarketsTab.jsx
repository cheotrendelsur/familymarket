import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle, Clock, Lock, Pencil, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useGame } from '../../context/GameContext'
import { useConfirm } from '../../components/ConfirmDialog'
import { StateBadge } from '../../components/Countdown'
import ImagePicker from '../../components/ImagePicker'
import MarketImage from '../../components/MarketImage'
import Sheet from '../../components/ui/Sheet'
import { noPrice, yesPrice } from '../../lib/trading'
import { friendlyError, money, sideLabel } from '../../lib/format'
import { fromLocalInput, toLocalInput } from '../../lib/time'
import { serverNow } from '../../lib/clock'
import { uploadMarketImages, releaseProcessed } from '../../lib/images'
import { haptic, HAPTIC } from '../../lib/fx'
import { CategoryPicker, ClosesAtField, Field, Notice, inputClass } from './adminUi'

const FILTERS = [
  ['open', 'Abiertos'],
  ['pending', 'Esperando resultado'],
  ['resolved', 'Resueltos'],
]

function EditSheet({ market, onClose, onSaved }) {
  const isGroup = !!market.group_id
  const [question, setQuestion] = useState(market.question)
  const [topic, setTopic] = useState(market.group_topic || '')
  const [description, setDescription] = useState(market.description || '')
  const [category, setCategory] = useState(market.category || 'otros')
  const [closesLocal, setClosesLocal] = useState(market.closes_at && market.state === 'open' ? toLocalInput(market.closes_at) : '')
  const [processed, setProcessed] = useState(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const existing = !removeImage ? market.image_url || market.image_thumb_url : null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const patch = {}
      if (question.trim() !== market.question) patch.question = question.trim()
      if (isGroup && topic.trim() && topic.trim() !== market.group_topic) patch.group_topic = topic.trim()
      if (description.trim() !== (market.description || '')) patch.description = description.trim() || null
      if (category !== market.category) patch.category = category
      const originalClose = market.closes_at && market.state === 'open' ? toLocalInput(market.closes_at) : ''
      if (closesLocal !== originalClose) patch.closes_at = fromLocalInput(closesLocal)
      if (processed) {
        const img = await uploadMarketImages(processed)
        Object.assign(patch, img)
      } else if (removeImage) {
        Object.assign(patch, { image_url: null, image_thumb_url: null, image_color: null })
      }
      if (Object.keys(patch).length === 0) {
        onClose()
        return
      }
      await rpc('staff_update_market', { p_market_id: market.id, p_patch: patch, p_apply_group: true })
      releaseProcessed(processed)
      toast.success('Cambios guardados', { duration: 3500 })
      onSaved()
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={busy ? undefined : onClose} title={isGroup ? `${market.group_topic} — ${market.question}` : market.question} subtitle="Editar mercado">
      <div className="space-y-5 pb-4">
        {isGroup && (
          <Field label="Tema general" hint="Se cambia en todas las opciones.">
            <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={120} className={inputClass} />
          </Field>
        )}
        <Field label={isGroup ? 'Nombre de esta opción' : 'Pregunta'}>
          <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Categoría" hint={isGroup ? 'Se aplica a todo el grupo.' : undefined}>
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        <Field label="Cierre de apuestas" hint={market.state === 'pending' ? 'Ya cerró. Pon una fecha futura para volver a abrirlo.' : undefined}>
          <ClosesAtField value={closesLocal} onChange={setClosesLocal} />
        </Field>
        <Field label="Descripción">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} className={`${inputClass} resize-none`} />
        </Field>
        <Field label="Foto">
          <ImagePicker
            value={processed}
            onChange={setProcessed}
            existingUrl={existing}
            onRemoveExisting={() => setRemoveImage(true)}
            category={category}
            disabled={busy}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <button
          onClick={save}
          disabled={busy || question.trim().length < 3}
          className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50 shadow-lg shadow-blue-500/20"
        >
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </Sheet>
  )
}

function MarketAdminCard({ market, isOwner, onResolve, onEdit, onCloseNow, onAnnul, onReopen }) {
  const pseudo = { kind: 'single', state: market.state, market, closes_at: market.state === 'open' ? market.closes_at : null }
  return (
    <div className={`border rounded-2xl p-4 ${market.state === 'resolved' ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200 shadow-card'}`}>
      <div className="flex items-start gap-3">
        <MarketImage item={market} size={44} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-gray-900 leading-snug">{market.question}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StateBadge item={pseudo} />
            {market.target_users?.length > 0 && <span className="text-xs text-gray-500">👻 oculto para {market.target_users.length}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="bg-emerald-50 rounded-xl px-3 py-2 border border-emerald-100">
          <span className="text-xs font-semibold text-gray-500">{sideLabel('YES')}</span>
          <span className="float-right font-extrabold text-polygreen tabular-nums">{(yesPrice(market) * 100).toFixed(1)}¢</span>
        </div>
        <div className="bg-rose-50 rounded-xl px-3 py-2 border border-rose-100">
          <span className="text-xs font-semibold text-gray-500">{sideLabel('NO')}</span>
          <span className="float-right font-extrabold text-polyred tabular-nums">{(noPrice(market) * 100).toFixed(1)}¢</span>
        </div>
      </div>

      {market.state !== 'resolved' ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onResolve(market, 'YES')}
              className="flex items-center justify-center gap-1.5 bg-polygreen text-white py-3 rounded-xl font-bold shadow-md shadow-green-500/20 tap-feedback"
            >
              <CheckCircle size={18} strokeWidth={2.5} /> Gana Sí
            </button>
            <button
              onClick={() => onResolve(market, 'NO')}
              className="flex items-center justify-center gap-1.5 bg-polyred text-white py-3 rounded-xl font-bold shadow-md shadow-red-500/20 tap-feedback"
            >
              <XCircle size={18} strokeWidth={2.5} /> Gana No
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onEdit(market)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-bold">
              <Pencil size={15} /> Editar
            </button>
            {market.state === 'open' && (
              <button onClick={() => onCloseNow(market)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-50 text-amber-700 text-sm font-bold border border-amber-100">
                <Lock size={15} /> Cerrar apuestas
              </button>
            )}
            {isOwner && (
              <button onClick={() => onAnnul(market)} className="px-3.5 flex items-center justify-center rounded-xl bg-white text-gray-400 hover:text-red-600 border border-gray-200" aria-label="Anular mercado">
                <Trash2 size={17} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`flex-1 text-center text-sm font-bold py-2 rounded-xl ${market.outcome === 'YES' ? 'bg-emerald-100 text-polygreen' : 'bg-rose-100 text-polyred'}`}
          >
            Ganó «{sideLabel(market.outcome)}»
          </span>
          <button onClick={() => onEdit(market)} className="px-3.5 py-2.5 rounded-xl bg-gray-100 text-gray-700" aria-label="Editar">
            <Pencil size={16} />
          </button>
          {isOwner && (
            <button onClick={() => onReopen(market)} className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-bold">
              <RotateCcw size={15} /> Deshacer
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function MarketsTab() {
  const { isOwner } = useAuth()
  const { markets, marketsLoaded, refreshMarkets, refreshSession } = useGame()
  const confirm = useConfirm()
  const [filter, setFilter] = useState('open')
  const [editing, setEditing] = useState(null)

  const counts = useMemo(() => {
    const c = { open: 0, pending: 0, resolved: 0 }
    for (const m of markets) c[m.state] += 1
    return c
  }, [markets])

  const groups = useMemo(() => {
    const list = markets.filter((m) => m.state === filter).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    const singles = []
    const byGroup = new Map()
    for (const m of list) {
      if (m.group_id) {
        if (!byGroup.has(m.group_id)) byGroup.set(m.group_id, [])
        byGroup.get(m.group_id).push(m)
      } else singles.push(m)
    }
    return { singles, groups: [...byGroup.entries()] }
  }, [markets, filter])

  const after = () => {
    refreshMarkets()
    refreshSession()
  }

  const handleResolve = async (market, outcome) => {
    const ok = await confirm({
      title: `Resolver: gana «${sideLabel(outcome)}»`,
      message: `${market.group_topic ? `${market.group_topic} — ` : ''}${market.question}\n\nPagará $1.00 por cada acción de «${sideLabel(outcome)}» y cerrará el mercado. Si te equivocas, el dueño puede deshacerlo.`,
      confirmText: `Gana ${sideLabel(outcome)}`,
      tone: 'danger',
    })
    if (!ok) return
    try {
      const data = await rpc('resolve_market', { p_market_id: market.id, p_outcome: outcome })
      haptic(HAPTIC.success)
      toast.success(`Resuelto. Ganó «${sideLabel(outcome)}» · Pagado ${money(data.total_paid)} a ${data.winners} jugador(es)`, { duration: 6000 })
      after()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const handleCloseNow = async (market) => {
    const ok = await confirm({
      title: 'Cerrar las apuestas ahora',
      message: `Nadie podrá comprar ni vender en «${market.question}». Quedará esperando el resultado.`,
      confirmText: 'Cerrar apuestas',
    })
    if (!ok) return
    try {
      await rpc('staff_update_market', { p_market_id: market.id, p_patch: { closes_at: new Date(serverNow() - 2000).toISOString() }, p_apply_group: false })
      toast.success('Apuestas cerradas', { duration: 3500 })
      after()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const handleAnnul = async (market) => {
    const ok = await confirm({
      title: 'Anular y borrar mercado',
      message: `«${market.question}»\n\n• Devuelve a los jugadores el dinero invertido.\n• Revierte las ganancias de quienes vendieron antes.\n• Borra todo su historial.\n\nEs como si el mercado nunca hubiera existido. No se puede deshacer.`,
      confirmText: 'Anular mercado',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const data = await rpc('delete_market_and_refund', { p_market_id: market.id })
      toast.success(
        `Mercado anulado · ${data.users} jugador(es) ajustados${data.clamped_users ? ` (${data.clamped_users} sin saldo suficiente para devolver ganancias)` : ''}`,
        { duration: 6000 }
      )
      after()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const handleReopen = async (market) => {
    const ok = await confirm({
      title: 'Deshacer la resolución',
      message: `«${market.question}»\n\nSe le quita el pago a quienes cobraron y el mercado vuelve a quedar abierto para que lo resuelvas bien. Cada jugador recibirá un aviso.`,
      confirmText: 'Deshacer resolución',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const data = await rpc('admin_reopen_market', { p_market_id: market.id })
      toast.success(`Resolución deshecha · ${money(data.reversed)} devueltos de ${data.users} jugador(es)`, { duration: 6000 })
      setFilter('open')
      after()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const closeGroup = async (list) => {
    const first = list[0]
    const ok = await confirm({
      title: 'Cerrar apuestas del grupo',
      message: `Se cierran las apuestas de las ${list.length} opciones de «${first.group_topic}».`,
      confirmText: 'Cerrar apuestas',
    })
    if (!ok) return
    try {
      await rpc('staff_update_market', { p_market_id: first.id, p_patch: { closes_at: new Date(serverNow() - 2000).toISOString() }, p_apply_group: true })
      toast.success('Apuestas cerradas', { duration: 3500 })
      after()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const cardProps = { isOwner, onResolve: handleResolve, onEdit: setEditing, onCloseNow: handleCloseNow, onAnnul: handleAnnul, onReopen: handleReopen }
  const empty = marketsLoaded && groups.singles.length === 0 && groups.groups.length === 0

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`flex-shrink-0 h-9 px-4 rounded-full text-sm font-semibold border ${
              filter === id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {label} <span className="opacity-60">{counts[id]}</span>
          </button>
        ))}
      </div>

      {filter === 'pending' && counts.pending > 0 && (
        <Notice tone="ok">
          <span className="flex items-center gap-1.5"><Clock size={15} /> Estos mercados ya cerraron apuestas: resuélvelos para pagar los premios.</span>
        </Notice>
      )}

      {empty && <p className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-gray-200">No hay mercados en esta lista.</p>}

      <div className="space-y-3">
        {groups.singles.map((m) => (
          <MarketAdminCard key={m.id} market={m} {...cardProps} />
        ))}
        {groups.groups.map(([gid, list]) => (
          <div key={gid} className="bg-blue-50/50 border border-blue-100 rounded-3xl p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <h3 className="font-extrabold text-gray-900 leading-snug">{list[0].group_topic}</h3>
              {filter === 'open' && (
                <button onClick={() => closeGroup(list)} className="text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-3 py-1.5 flex-shrink-0">
                  Cerrar apuestas del grupo
                </button>
              )}
            </div>
            {list.map((m) => (
              <MarketAdminCard key={m.id} market={m} {...cardProps} />
            ))}
          </div>
        ))}
      </div>

      {editing && <EditSheet market={editing} onClose={() => setEditing(null)} onSaved={after} />}
    </div>
  )
}
