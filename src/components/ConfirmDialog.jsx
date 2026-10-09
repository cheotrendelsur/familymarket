import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

const ConfirmContext = createContext(null)

/**
 * Reemplaza window.confirm / alert (que se ven mal y a veces se bloquean en
 * apps instaladas en iOS). Uso:
 *   const confirm = useConfirm()
 *   if (!(await confirm({ title, message, confirmText, tone: 'danger' }))) return
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useConfirm = () => {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm debe usarse dentro de ConfirmProvider')
  return confirm
}

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const resolverRef = useRef(null)

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolverRef.current = resolve
        setDialog(options)
      }),
    []
  )

  const close = useCallback((result) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setDialog(null)
  }, [])

  useEffect(() => {
    if (!dialog) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, close])

  const value = useMemo(() => confirm, [confirm])
  const danger = dialog?.tone === 'danger'

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => close(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              {danger && (
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={22} className="text-polyred" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-gray-900">{dialog.title}</h3>
                {dialog.message && (
                  <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{dialog.message}</p>
                )}
              </div>
            </div>
            {dialog.details && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 text-sm space-y-1.5">
                {dialog.details.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-semibold text-gray-900 text-right">{value}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => close(false)}
                className="py-3.5 rounded-xl font-bold bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                {dialog.cancelText || 'Cancelar'}
              </button>
              <button
                autoFocus
                onClick={() => close(true)}
                className={`py-3.5 rounded-xl font-bold text-white ${
                  danger ? 'bg-polyred hover:bg-red-700' : 'bg-polyblue hover:bg-blue-700'
                }`}
              >
                {dialog.confirmText || 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
