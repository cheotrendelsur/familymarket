import { memo } from 'react'

/** Anillo de probabilidad (como el de Polymarket): el arco crece con la probabilidad de "Sí". */
function ChanceRing({ value, size = 52, stroke = 5, label = 'Sí', className = '' }) {
  const v = Math.min(Math.max(Number(value) || 0, 0), 1)
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = v >= 0.5 ? '#009E60' : '#F59E0B'
  return (
    <div className={`relative flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F3" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.3s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-extrabold text-gray-900" style={{ fontSize: size * 0.27 }}>
          {Math.round(v * 100)}%
        </span>
        {label && (
          <span className="font-semibold text-gray-400 mt-0.5" style={{ fontSize: Math.max(size * 0.17, 9) }}>
            {label}
          </span>
        )}
      </div>
    </div>
  )
}

export default memo(ChanceRing)
