import { useState } from 'react'
import toast from 'react-hot-toast'
import { rpc } from '../../lib/api'
import ImagePicker from '../../components/ImagePicker'
import Sheet from '../../components/ui/Sheet'
import { friendlyError } from '../../lib/format'
import { fromLocalInput, toLocalInput } from '../../lib/time'
import { releaseProcessed, uploadMarketImages } from '../../lib/images'
import { CategoryPicker, ClosesAtField, Field, Notice, OpensAtField, inputClass } from './adminUi'

/** Editar un mercado (o todo su grupo): texto, categoría, cierre y foto. */
export default function EditSheet({ market, onClose, onSaved }) {
  const isGroup = !!market.group_id
  const [question, setQuestion] = useState(market.question)
  const [topic, setTopic] = useState(market.group_topic || '')
  const [description, setDescription] = useState(market.description || '')
  const [category, setCategory] = useState(market.category || 'otros')
  const [closesLocal, setClosesLocal] = useState(market.closes_at && market.state === 'open' ? toLocalInput(market.closes_at) : '')
  const canReschedule = (market.state === 'upcoming' || market.state === 'open') && !(Number(market.trades_total) > 0)
  const [opensLocal, setOpensLocal] = useState(market.opens_at && market.state === 'upcoming' ? toLocalInput(market.opens_at) : '')
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
      const originalOpen = market.opens_at && market.state === 'upcoming' ? toLocalInput(market.opens_at) : ''
      if (canReschedule && opensLocal !== originalOpen) patch.opens_at = fromLocalInput(opensLocal)
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
        {canReschedule && (
          <Field label="Apertura" hint="Solo se puede cambiar mientras nadie haya operado.">
            <OpensAtField value={opensLocal} onChange={setOpensLocal} />
          </Field>
        )}
        <Field label="Cierre de apuestas" hint={market.state === 'pending' ? 'Ya cerró. Pon una fecha futura para volver a abrirlo.' : undefined}>
          <ClosesAtField value={closesLocal} onChange={setClosesLocal} />
        </Field>
        <Field label="Categoría" hint={isGroup ? 'Se aplica a todo el grupo.' : undefined}>
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>
        <Field label="Descripción">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} className={`${inputClass} resize-none`} />
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
