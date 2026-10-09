import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CheckCircle2, Clock, Lightbulb, Loader2, Plus, Send, Trash2, XCircle } from 'lucide-react'
import { rpc } from '../lib/api'
import { CATEGORIES, categoryOf } from '../lib/categories'
import { friendlyError } from '../lib/format'
import { timeAgo } from '../lib/time'
import { fireSoftConfetti, haptic, HAPTIC } from '../lib/fx'

const inputClass =
  'w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-polyblue focus:ring-4 focus:ring-polyblue/10 outline-none transition bg-white'

const STATUS = {
  pending: { label: 'En revisión', Icon: Clock, tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  approved: { label: 'Aprobada', Icon: CheckCircle2, tone: 'bg-emerald-50 text-polygreen border-emerald-200' },
  rejected: { label: 'No aprobada', Icon: XCircle, tone: 'bg-rose-50 text-polyred border-rose-200' },
}

export default function SuggestPage() {
  const navigate = useNavigate()
  const [question, setQuestion] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('otros')
  const [multiple, setMultiple] = useState(false)
  const [options, setOptions] = useState(['', ''])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [mine, setMine] = useState(null)

  const load = useCallback(async () => {
    try {
      setMine((await rpc('get_my_suggestions')) || [])
    } catch {
      setMine([])
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const pending = mine?.filter((s) => s.status === 'pending').length ?? 0
  const q = question.trim()
  const validOptions = options.map((o) => o.trim()).filter(Boolean)
  const canSend =
    q.length >= 8 && !sending && pending < 3 && (!multiple || (validOptions.length >= 2 && validOptions.length <= 10))

  const submit = async (e) => {
    e.preventDefault()
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      await rpc('suggest_market', {
        p_question: q,
        p_description: description.trim() || null,
        p_category: category,
        p_options: multiple ? validOptions : null,
      })
      haptic(HAPTIC.success)
      fireSoftConfetti()
      toast.success('¡Sugerencia enviada! Los administradores la van a revisar.', { duration: 4500 })
      setQuestion('')
      setDescription('')
      setOptions(['', ''])
      setMultiple(false)
      setCategory('otros')
      load()
    } catch (err) {
      setError(friendlyError(err))
      haptic(HAPTIC.reject)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-yellow-300 to-amber-500 flex items-center justify-center shadow-lg">
          <Lightbulb size={26} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Sugerir un mercado</h1>
          <p className="text-sm text-gray-500">Propón una pregunta; si gusta, la publican para todos</p>
        </div>
      </div>

      <form onSubmit={submit} className="bg-white rounded-3xl border border-gray-200 shadow-card p-5 space-y-5">
        <div>
          <label htmlFor="sg-question" className="block text-sm font-bold text-gray-700 mb-1.5">
            {multiple ? 'Tema general' : 'Tu pregunta'}
          </label>
          <input
            id="sg-question"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={multiple ? '¿Quién ganará el torneo de dominó?' : '¿Lloverá el sábado en Margarita?'}
            maxLength={200}
            className={inputClass}
          />
          <p className="text-xs text-gray-400 mt-1">Debe poder responderse con Sí o No (mínimo 8 letras). {q.length}/200</p>
        </div>

        <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-4">
          <div>
            <p className="font-bold text-gray-900">Varias opciones</p>
            <p className="text-xs text-gray-500">Ej: «¿Quién ganará?» con un nombre por opción</p>
          </div>
          <button
            type="button"
            onClick={() => setMultiple(!multiple)}
            aria-pressed={multiple}
            className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors ${multiple ? 'bg-polyblue' : 'bg-gray-300'}`}
          >
            <span className={`bg-white w-6 h-6 rounded-full shadow transition-transform ${multiple ? 'translate-x-6' : ''}`} />
          </button>
        </div>

        {multiple && (
          <div className="space-y-2.5 animate-fade-in">
            {options.map((opt, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => setOptions(options.map((o, i) => (i === idx ? e.target.value : o)))}
                  placeholder={`Opción ${idx + 1}`}
                  maxLength={80}
                  className={`${inputClass} flex-1`}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => setOptions(options.filter((_, i) => i !== idx))}
                    className="px-3 text-red-500"
                    aria-label="Quitar opción"
                  >
                    <Trash2 size={20} />
                  </button>
                )}
              </div>
            ))}
            {options.length < 10 && (
              <button
                type="button"
                onClick={() => setOptions([...options, ''])}
                className="text-polyblue font-bold text-sm flex items-center gap-1 px-1 py-1"
              >
                <Plus size={17} /> Agregar otra opción
              </button>
            )}
          </div>
        )}

        <div>
          <p className="block text-sm font-bold text-gray-700 mb-1.5">Categoría</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
                className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors ${
                  category === c.id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'
                }`}
              >
                <span>{c.emoji}</span> {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="sg-desc" className="block text-sm font-bold text-gray-700 mb-1.5">
            Detalles (opcional)
          </label>
          <textarea
            id="sg-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={400}
            placeholder="¿Cómo se sabrá el resultado? ¿Hasta cuándo?"
            className={`${inputClass} resize-none`}
          />
        </div>

        {error && <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</p>}
        {pending >= 3 && (
          <p className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
            Ya tienes 3 sugerencias en revisión. Espera a que las revisen para enviar más.
          </p>
        )}

        <button
          type="submit"
          disabled={!canSend}
          className="w-full flex items-center justify-center gap-2 bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-45 shadow-lg shadow-blue-500/20 tap-feedback"
        >
          {sending ? <Loader2 className="animate-spin" size={20} /> : <Send size={19} />}
          {sending ? 'Enviando…' : 'Enviar sugerencia'}
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="text-lg font-extrabold text-gray-900">Mis sugerencias</h2>
        {mine === null && <div className="skeleton h-20 rounded-2xl" />}
        {mine && mine.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8 bg-white rounded-2xl border border-gray-200">
            Todavía no has sugerido nada. ¡Anímate!
          </p>
        )}
        {mine?.map((s) => {
          const st = STATUS[s.status]
          const cat = categoryOf(s.category)
          return (
            <div key={s.id} className="bg-white rounded-2xl border border-gray-200 shadow-card p-4 animate-slide-up">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-gray-900 leading-snug">{s.question}</p>
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border flex-shrink-0 ${st.tone}`}>
                  <st.Icon size={13} /> {st.label}
                </span>
              </div>
              {s.options?.length > 0 && <p className="text-xs text-gray-500 mt-1.5">Opciones: {s.options.join(' · ')}</p>}
              <p className="text-xs text-gray-400 mt-1.5">
                {cat.emoji} {cat.label} · {timeAgo(s.created_at)}
              </p>
              {s.status === 'rejected' && s.reject_reason && (
                <p className="text-sm text-rose-700 bg-rose-50 rounded-xl px-3 py-2 mt-2.5">Motivo: {s.reject_reason}</p>
              )}
              {s.status === 'approved' && (
                <button onClick={() => navigate('/')} className="mt-2.5 text-sm font-bold text-polyblue">
                  Ya está publicada — ir al inicio →
                </button>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}
