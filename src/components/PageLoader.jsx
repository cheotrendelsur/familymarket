export function Spinner({ size = 'md' }) {
  const dims = size === 'lg' ? 'h-14 w-14 border-b-4' : size === 'sm' ? 'h-5 w-5 border-b-2' : 'h-10 w-10 border-b-2'
  return <div className={`animate-spin rounded-full ${dims} border-polyblue mx-auto`} role="status" aria-label="Cargando" />
}

export default function PageLoader({ label = 'Cargando...', fullScreen = false }) {
  return (
    <div className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'min-h-[50vh]'} bg-polygray-bg`}>
      <div className="text-center">
        <Spinner size={fullScreen ? 'lg' : 'md'} />
        <p className="text-gray-600 font-medium mt-4">{label}</p>
      </div>
    </div>
  )
}
