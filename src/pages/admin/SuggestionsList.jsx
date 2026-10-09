import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, Inbox, Pencil, X } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useGame } from '../../context/GameContext'
import { usePolling } from '../../hooks/usePolling'
import { categoryOf } from '../../lib/categories'
import { friendlyError } from '../../lib/format'
import { timeAgo } from '../../lib/time'
import { fireSoftConfetti, haptic, HAPTIC } from '../../lib/fx'
import Sheet from '../../components/ui/Sheet'
import { Avatar } from '../../components/Leaderboard'
import MarketForm from './MarketForm'
import { Field, Notice, inputClass } from './adminUi'

const QUICK_REASONS = ['Ya existe uno parecido', 'No se puede comprobar el resultado', 'Es muy personal', 'Está confusa, reformúlala']

function RejectSheet({ suggestion, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await rpc('staff_review_suggestion', { p_id: suggestion.id, p_action: 'reject', p_reason: reason.trim() || null })
      toast.success('Sugerencia rechazada. Le avisamos al jugador.', { duration: 4000 })
      onDone()
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={busy ? undefined : onClose} title={suggestion.question} subtitle="Rechazar sugerencia">
      <div className="space-y-4 pb-4">
        <div className="flex flex-wrap gap-2">
          {QUICK_REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} aria-pressed={reason === r} className={`px-3 py-2 rounded-full text-sm font-semibold ${reason === r ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {r}
            </button>
          ))}
        </div>
        <Field label="Motivo (opcional)" hint="Se lo mostramos a quien la sugirió.">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} className={`${inputClass} resize-none`} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <button onClick={send} disabled={busy} className="w-full bg-polyred text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
          {busy ? 'Enviando…' : 'Rechazar'}
        </button>
      </div>
    </Sheet>
  )
}

function ApproveSheet({ suggestion, onClose, onDone }) {
  const multiple = suggestion.options?.length >= 2
  const approve = async (v) => {
    const img = v.image || {}
    await rpc('staff_review_suggestion', {
      p_id: suggestion.id,
      p_action: 'approve',
      p_question: v.question,
      p_description: v.description,
      p_category: v.category,
      p_closes_at: v.closes_at,
      p_image_url: img.image_url || null,
      p_image_thumb_url: img.image_thumb_url || null,
      p_image_color: img.image_color || null,
      p_target_users: v.target_users,
    })
    haptic(HAPTIC.success)
    fireSoftConfetti()
    toast.success('¡Publicado! Le avisamos a quien lo sugirió.', { duration: 4500 })
    onDone()
    onClose()
  }
  return (
    <Sheet open onClose={onClose} title={suggestion.question} subtitle={`Editar y publicar · de ${suggestion.username}`}>
      <div className="pb-4">
        <MarketForm
          initial={{ question: suggestion.question, description: suggestion.description, category: suggestion.category }}
          kindLocked={multiple ? 'multiple' : 'single'}
          fixedOptions={multiple ? suggestion.options : null}
          submitLabel="Publicar mercado"
          onSubmit={approve}
        />
      </div>
    </Sheet>
  )
}

const STATUS_STYLE = {
  approved: 'bg-emerald-50 text-polygreen',
  rejected: 'bg-rose-50 text-polyred',
}

/** Lista de sugerencias: `view` = 'pending' (por revisar) o 'history' (ya revisadas). */
export default function SuggestionsList({ view = 'pending', emptyText }) {
  const { refreshMarkets, refreshSession } = useGame()
  const [list, setList] = useState(null)
  const [approving, setApproving] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [publishing, setPublishing] = useState(null)

  const load = useCallback(async () => {
    const data = await rpc('staff_list_suggestions', { p_status: view === 'pending' ? 'pending' : null })
    setList(view === 'pending' ? data || [] : (data || []).filter((s) => s.status !== 'pending'))
  }, [view])
  const { refresh } = usePolling(load, { interval: 20000 })

  const done = () => {
    refresh()
    refreshMarkets()
    refreshSession()
  }

  // Publicar tal cual la mandó el jugador, de un toque.
  const publishNow = async (s) => {
    setPublishing(s.id)
    try {
      await rpc('staff_review_suggestion', { p_id: s.id, p_action: 'approve' })
      haptic(HAPTIC.success)
      fireSoftConfetti()
      toast.success('¡Publicado! Le avisamos a quien lo sugirió.', { duration: 4500 })
      done()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    } finally {
      setPublishing(null)
    }
  }

  return (
    <div className="space-y-3">
      {list === null && <div className="skeleton h-28 rounded-2xl" />}
      {list && list.length === 0 && (
        <div className="text-center py-10 bg-white rounded-2xl border border-gray-200 text-gray-400">
          <Inbox size={36} className="mx-auto mb-2 text-gray-300" />
          {emptyText || (view === 'pending' ? 'No hay sugerencias por revisar.' : 'Todavía no has revisado ninguna.')}
        </div>
      )}

      {list?.map((s) => {
        const cat = categoryOf(s.category)
        return (
          <div key={s.id} className="bg-white rounded-2xl border border-gray-200 shadow-card p-4 animate-slide-up">
            <div className="flex items-center gap-2.5 mb-2.5">
              <Avatar name={s.username} size={30} />
              <span className="text-sm font-bold text-gray-800">{s.username}</span>
              <span className="text-xs text-gray-400 ml-auto">{timeAgo(s.created_at)}</span>
            </div>
            <p className="font-semibold text-gray-900 leading-snug">{s.question}</p>
            {s.description && <p className="text-sm text-gray-500 mt-1 leading-snug">{s.description}</p>}
            {s.options?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {s.options.map((o) => (
                  <span key={o} className="text-xs font-semibold bg-blue-50 text-polyblue rounded-full px-2.5 py-1">
                    {o}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-2.5">
              {cat.emoji} {cat.label}
            </p>

            {s.status === 'pending' ? (
              <div className="grid grid-cols-[auto_auto_1fr] gap-2 mt-3">
                <button onClick={() => setRejecting(s)} aria-label="Rechazar" className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-rose-50 text-polyred font-bold tap-feedback">
                  <X size={18} strokeWidth={2.6} /> No
                </button>
                <button onClick={() => setApproving(s)} aria-label="Editar y publicar" className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl bg-gray-100 text-gray-700 font-bold tap-feedback">
                  <Pencil size={16} /> Editar
                </button>
                <button
                  onClick={() => publishNow(s)}
                  disabled={publishing === s.id}
                  className="flex items-center justify-center gap-1.5 py-3 rounded-xl bg-polygreen text-white font-bold shadow-md shadow-green-500/20 tap-feedback disabled:opacity-60"
                >
                  <Check size={18} strokeWidth={2.8} /> {publishing === s.id ? 'Publicando…' : 'Publicar'}
                </button>
              </div>
            ) : (
              <p className={`mt-3 text-sm font-bold rounded-xl px-3 py-2 ${STATUS_STYLE[s.status]}`}>
                {s.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                {s.reviewed_by_username ? ` por ${s.reviewed_by_username}` : ''}
                {s.reject_reason ? ` · ${s.reject_reason}` : ''}
              </p>
            )}
          </div>
        )
      })}

      {approving && <ApproveSheet suggestion={approving} onClose={() => setApproving(null)} onDone={done} />}
      {rejecting && <RejectSheet suggestion={rejecting} onClose={() => setRejecting(null)} onDone={done} />}
    </div>
  )
}
