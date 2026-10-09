import { useEffect, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { processImageFile, releaseProcessed } from '../lib/images'
import { friendlyError } from '../lib/format'
import { categoryOf } from '../lib/categories'

const kb = (blob) => `${Math.max(1, Math.round(blob.size / 1024))} KB`

/**
 * Elegir la foto de un mercado: cámara o galería. La imagen se recorta (16:9) y se
 * comprime en el celular, así lo que se sube pesa unas decenas de KB.
 *  · value: resultado de processImageFile() o null
 *  · existingUrl: foto actual al editar (se muestra hasta que elijas otra)
 * Sin foto muestra solo dos botones grandes; con foto, la vista previa y «Cambiar / Quitar».
 */
export default function ImagePicker({ value, onChange, existingUrl = null, onRemoveExisting, category = 'otros', disabled = false }) {
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => () => releaseProcessed(valueRef.current), [])

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const processed = await processImageFile(file)
      releaseProcessed(valueRef.current)
      onChange(processed)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    if (value) {
      releaseProcessed(value)
      onChange(null)
    } else {
      onRemoveExisting?.()
    }
  }

  const cat = categoryOf(category)
  const preview = value?.previewUrl || existingUrl
  const canRemove = !!value || (!!existingUrl && !!onRemoveExisting)

  return (
    <div className="space-y-2.5">
      {preview ? (
        <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden border border-gray-200 bg-gray-100">
          <img src={preview} alt="Vista previa de la foto" className="absolute inset-0 w-full h-full object-cover" />
          {busy && (
            <div className="absolute inset-0 bg-white/80 flex items-center justify-center gap-2 font-semibold text-gray-700">
              <Loader2 className="animate-spin" size={20} /> Optimizando foto…
            </div>
          )}
        </div>
      ) : busy ? (
        <div className="w-full aspect-[16/9] rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center gap-2 font-semibold text-gray-600">
          <Loader2 className="animate-spin" size={20} /> Optimizando foto…
        </div>
      ) : null}

      {value && (
        <p className="text-xs text-gray-500 text-center">
          Lista: banner {kb(value.main.blob)} · miniatura {kb(value.thumb.blob)} ({value.main.ext.toUpperCase()})
        </p>
      )}
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => cameraRef.current?.click()}
          className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-blue-50 text-polyblue font-bold border border-blue-100 disabled:opacity-50 tap-feedback"
        >
          {preview ? <RefreshCw size={17} /> : <Camera size={19} />} {preview ? 'Otra foto' : 'Tomar foto'}
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => galleryRef.current?.click()}
          className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gray-100 text-gray-700 font-bold disabled:opacity-50 tap-feedback"
        >
          <ImageIcon size={19} /> Galería
        </button>
      </div>
      {!preview && (
        <p className="text-xs text-gray-400 text-center">
          Opcional. Sin foto se ve el ícono {cat.emoji} de la categoría. Se recorta y comprime sola.
        </p>
      )}
      {canRemove && (
        <button
          type="button"
          onClick={remove}
          disabled={disabled || busy}
          className="w-full flex items-center justify-center gap-2 py-1.5 text-sm font-semibold text-red-500"
        >
          <Trash2 size={15} /> {value ? 'Quitar esta foto' : 'Quitar la foto actual'}
        </button>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={pick} />
    </div>
  )
}
