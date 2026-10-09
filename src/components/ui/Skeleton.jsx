export function Skeleton({ className = '' }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />
}

/** Tarjeta de mercado "fantasma" mientras cargan los datos. */
export function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3.5" aria-hidden="true">
      <div className="flex gap-3">
        <Skeleton className="w-[52px] h-[52px] rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="w-[52px] h-[52px] rounded-full flex-shrink-0" />
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <Skeleton className="h-11 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
