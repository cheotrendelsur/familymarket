// Procesamiento de fotos de mercados en el propio celular, ANTES de subirlas:
//  · recorte centrado (banner 16:9 + miniatura cuadrada)
//  · WebP (JPEG en navegadores que no lo codifican, p. ej. Safari de iOS)
//  · color promedio para el "placeholder" mientras carga
// Resultado: ~40-70 KB el banner y ~6-12 KB la miniatura, aunque la foto original pese 8 MB.
import { db } from './api'
import { newRequestId } from './trading'

const MAIN = { w: 960, h: 540, q: 0.78 }
const THUMB = { w: 192, h: 192, q: 0.72 }
const MAX_INPUT_BYTES = 40 * 1024 * 1024

async function loadSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }
    } catch {
      /* algunos navegadores no aceptan las opciones: se prueba sin ellas */
    }
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() }
    } catch {
      /* se usa <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () =>
      resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen'))
    }
    img.src = url
  })
}

function drawCover(source, sw, sh, dw, dh) {
  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, dw, dh)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const scale = Math.max(dw / sw, dh / sh)
  const cw = dw / scale
  const ch = dh / scale
  ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, dw, dh)
  return canvas
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality))

async function encode(canvas, quality) {
  const webp = await toBlob(canvas, 'image/webp', quality)
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', mime: 'image/webp' }
  const jpeg = await toBlob(canvas, 'image/jpeg', Math.min(quality + 0.08, 0.9))
  if (!jpeg) throw new Error('Tu navegador no pudo preparar la imagen')
  return { blob: jpeg, ext: 'jpg', mime: 'image/jpeg' }
}

function averageColor(canvas) {
  const tiny = document.createElement('canvas')
  tiny.width = 8
  tiny.height = 8
  const ctx = tiny.getContext('2d')
  ctx.drawImage(canvas, 0, 0, 8, 8)
  const { data } = ctx.getImageData(0, 0, 8, 8)
  let r = 0
  let g = 0
  let b = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * @param {File} file  foto elegida de la galería o tomada con la cámara
 * @returns {Promise<{main, thumb, color, previewUrl, thumbPreviewUrl}>}
 */
export async function processImageFile(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Elige un archivo de imagen')
  if (file.size > MAX_INPUT_BYTES) throw new Error('La imagen es demasiado pesada (máx. 40 MB)')
  const src = await loadSource(file)
  try {
    if (!src.width || !src.height) throw new Error('La imagen está vacía')
    const mainCanvas = drawCover(src.source, src.width, src.height, MAIN.w, MAIN.h)
    const thumbCanvas = drawCover(src.source, src.width, src.height, THUMB.w, THUMB.h)
    const [main, thumb] = await Promise.all([encode(mainCanvas, MAIN.q), encode(thumbCanvas, THUMB.q)])
    return {
      main,
      thumb,
      color: averageColor(thumbCanvas),
      previewUrl: URL.createObjectURL(main.blob),
      thumbPreviewUrl: URL.createObjectURL(thumb.blob),
    }
  } finally {
    src.release()
  }
}

export function releaseProcessed(processed) {
  if (!processed) return
  try {
    URL.revokeObjectURL(processed.previewUrl)
    URL.revokeObjectURL(processed.thumbPreviewUrl)
  } catch {
    /* nada */
  }
}

/** Sube banner + miniatura al bucket público y devuelve lo que se guarda en el mercado. */
export async function uploadMarketImages(processed) {
  const id = newRequestId()
  const mainPath = `m/${id}.${processed.main.ext}`
  const thumbPath = `m/${id}_t.${processed.thumb.ext}`
  const image_url = await db.uploadImage(mainPath, processed.main.blob, processed.main.mime)
  try {
    const image_thumb_url = await db.uploadImage(thumbPath, processed.thumb.blob, processed.thumb.mime)
    return { image_url, image_thumb_url, image_color: processed.color }
  } catch (err) {
    db.removeImages([mainPath]).catch(() => {})
    throw err
  }
}
