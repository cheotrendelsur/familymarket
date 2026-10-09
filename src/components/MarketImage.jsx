import { memo, useState } from 'react'
import { categoryOf } from '../lib/categories'

/**
 * Foto del mercado con carga progresiva:
 *  1. de inmediato se pinta el color promedio de la foto (sin saltos de diseño),
 *  2. la imagen (WebP liviano) aparece con un fundido cuando termina de cargar,
 *  3. sin foto (o si falla) se muestra un mosaico con el emoji de la categoría.
 * `variant`: 'thumb' (cuadrada, usa la miniatura) | 'banner' (16:9, usa la foto grande)
 */
function MarketImage({ item, variant = 'thumb', className = '', size = 52, priority = false }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const cat = categoryOf(item.category)
  const src = variant === 'banner' ? item.image_url || item.image_thumb_url : item.image_thumb_url || item.image_url
  const showImage = !!src && !failed

  const base = variant === 'banner' ? 'w-full aspect-[16/9]' : 'flex-shrink-0 rounded-xl'
  const style =
    variant === 'banner'
      ? undefined
      : { width: size, height: size }

  return (
    <div
      className={`relative overflow-hidden ${base} ${className}`}
      style={{
        ...style,
        background: showImage
          ? item.image_color || '#e5e7eb'
          : `linear-gradient(135deg, ${cat.from}, ${cat.to})`,
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center select-none"
          style={{ fontSize: variant === 'banner' ? 64 : Math.round(size * 0.5) }}
          aria-hidden="true"
        >
          {cat.emoji}
        </div>
      )}
    </div>
  )
}

export default memo(MarketImage)
