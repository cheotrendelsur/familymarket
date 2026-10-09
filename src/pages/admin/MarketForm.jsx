import { useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react'
import { rpc } from '../../lib/api'
import { fromLocalInput } from '../../lib/time'
import { serverNow } from '../../lib/clock'
import { friendlyError } from '../../lib/format'
import { releaseProcessed, uploadMarketImages } from '../../lib/images'
import ImagePicker from '../../components/ImagePicker'
import { CategoryPicker, ClosesAtField, Field, Notice, inputClass } from './adminUi'

/**
 * Formulario de mercado (crear uno nuevo o aprobar una sugerencia).
 * `onSubmit(values)` recibe: { kind, question, topic, options, description, category,
 *   closes_at, image: {image_url, image_thumb_url, image_color} | null, target_users }
 *  · kindLocked: 'single' | 'multiple' para fijar el tipo (sugerencias)
 *  · fixedOptions: opciones ya definidas por quien sugirió (no se editan)
 */
export default function MarketForm({ initial = {}, kindLocked = null, fixedOptions = null, submitLabel, onSubmit }) {
  const [kind, setKind] = useState(kindLocked || initial.kind || 'single')
  const [question, setQuestion] = useState(initial.question || '')
  const [options, setOptions] = useState(fixedOptions || ['', ''])
  const [description, setDescription] = useState(initial.description || '')
  const [category, setCategory] = useState(initial.category || 'otros')
  const [closesLocal, setClosesLocal] = useState('')
  const [processed, setProcessed] = useState(null)
  const [hiddenFrom, setHiddenFrom] = useState([])
  const [showHidden, setShowHidden] = useState(false)
  const [players, setPlayers] = useState([])
  const [busy, setBusy] = useState(null) // null | 'upload' | 'save'
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    rpc('staff_list_players')
      .then((p) => !cancelled && setPlayers(p || []))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const multiple = kind === 'multiple'
  const cleanOptions = (fixedOptions || options).map((o) => o.trim()).filter(Boolean)
  const closesIso = fromLocalInput(closesLocal)
  const closesInPast = closesIso && Date.parse(closesIso) <= serverNow() + 30000
  const canSubmit = question.trim().length >= 3 && (!multiple || cleanOptions.length >= 2) && !closesInPast && !busy

  const submit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    try {
      let image = null
      if (processed) {
        setBusy('upload')
        image = await uploadMarketImages(processed)
      }
      setBusy('save')
      await onSubmit({
        kind,
        question: question.trim(),
        options: cleanOptions,
        description: description.trim() || null,
        category,
        closes_at: closesIso,
        image,
        target_users: hiddenFrom.length ? hiddenFrom : null,
      })
      releaseProcessed(processed)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {!kindLocked && (
        <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1">
          {[
            ['single', 'Pregunta Sí / No'],
            ['multiple', 'Varias opciones'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className={`py-2.5 rounded-lg text-sm font-bold transition-all ${kind === id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <Field
        label={multiple ? 'Tema general *' : 'Pregunta *'}
        hint={multiple ? 'Ej: ¿Quién comerá más pizza?' : 'Debe poder responderse con Sí o No'}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={multiple ? '¿Quién comerá más pizza?' : '¿Lloverá mañana en Margarita?'}
          maxLength={multiple ? 120 : 200}
          className={inputClass}
          required
        />
      </Field>

      {multiple && (
        <div className="space-y-2.5 bg-blue-50/60 p-4 rounded-2xl border border-blue-100">
          <p className="text-sm font-bold text-gray-700">Opciones * (una por participante)</p>
          {fixedOptions ? (
            <ul className="space-y-1.5">
              {fixedOptions.map((o) => (
                <li key={o} className="bg-white rounded-xl px-3.5 py-2.5 text-sm font-medium border border-gray-200">
                  {o}
                </li>
              ))}
            </ul>
          ) : (
            <>
              {options.map((opt, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => setOptions(options.map((o, i) => (i === idx ? e.target.value : o)))}
                    placeholder={`Opción ${idx + 1} (Ej: Papá)`}
                    className={`${inputClass} flex-1`}
                    maxLength={200}
                  />
                  {options.length > 2 && (
                    <button type="button" onClick={() => setOptions(options.filter((_, i) => i !== idx))} className="px-3 text-red-500" aria-label="Quitar opción">
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setOptions([...options, ''])} className="text-polyblue font-bold text-sm flex items-center gap-1 px-1 py-1">
                <Plus size={17} /> Agregar otra opción
              </button>
            </>
          )}
        </div>
      )}

      <Field label="Categoría">
        <CategoryPicker value={category} onChange={setCategory} />
      </Field>

      <Field label="Cierre de apuestas (opcional)">
        <ClosesAtField value={closesLocal} onChange={setClosesLocal} />
        {closesInPast && <p className="text-xs text-red-600 mt-1.5 font-semibold">La fecha de cierre debe estar en el futuro.</p>}
      </Field>

      <Field label="Descripción (opcional)" hint="Cuenta cómo se sabrá el resultado.">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Contexto adicional sobre el mercado…"
          className={`${inputClass} resize-none`}
        />
      </Field>

      <Field label="Foto (opcional)" hint="Se recorta y comprime sola para que cargue rápido.">
        <ImagePicker value={processed} onChange={setProcessed} category={category} disabled={!!busy} />
      </Field>

      <div className="rounded-2xl border border-gray-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowHidden(!showHidden)}
          className="w-full flex items-center justify-between px-4 py-3.5 bg-gray-50 text-left"
          aria-expanded={showHidden}
        >
          <span className="font-bold text-gray-800 text-sm">
            👻 Mercado sorpresa {hiddenFrom.length > 0 && <span className="text-polyblue">· oculto para {hiddenFrom.length}</span>}
          </span>
          <ChevronDown size={18} className={`transition-transform text-gray-400 ${showHidden ? 'rotate-180' : ''}`} />
        </button>
        {showHidden && (
          <div className="p-4 space-y-3 animate-fade-in">
            <p className="text-xs text-gray-500">Elige a quién quieres <b>ocultarle</b> este mercado (por ejemplo, la persona sorprendida). Si no eliges a nadie, lo ven todos.</p>
            <div className="grid grid-cols-2 gap-2">
              {players.map((u) => {
                const selected = hiddenFrom.includes(u.id)
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setHiddenFrom(selected ? hiddenFrom.filter((id) => id !== u.id) : [...hiddenFrom, u.id])}
                    aria-pressed={selected}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 text-left transition-colors ${
                      selected ? 'bg-blue-50 border-polyblue' : 'bg-white border-gray-200'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${selected ? 'bg-polyblue border-polyblue' : 'bg-gray-100 border-gray-300'}`}>
                      {selected && <Check size={13} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className={`text-sm font-bold truncate ${selected ? 'text-polyblue' : 'text-gray-700'}`}>{u.username}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full flex items-center justify-center gap-2 bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-45 shadow-lg shadow-blue-500/20 tap-feedback"
      >
        {busy && <Loader2 size={20} className="animate-spin" />}
        {busy === 'upload' ? 'Subiendo foto…' : busy === 'save' ? 'Guardando…' : submitLabel}
      </button>
    </form>
  )
}
