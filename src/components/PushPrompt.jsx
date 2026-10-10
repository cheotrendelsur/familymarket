import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Bell } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { enablePush, getPushStatus, syncPush, unblockHelp } from '../lib/push'
import { store } from '../lib/storage'
import Sheet from './ui/Sheet'

const DISMISS_KEY = 'fm_push_dismissed' // «Ahora no» solo vale para esta vez que se abrió la app
const NEVER_KEY = 'fm_push_never' // solo para iPhone con iOS viejo, donde no hay nada que activar
const AWAY_MS = 30 * 60 * 1000 // si vuelves a la app después de 30 min fuera, se vuelve a avisar

const readDismissed = () => {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
const writeDismissed = (v) => {
  try {
    if (v) window.sessionStorage.setItem(DISMISS_KEY, '1')
    else window.sessionStorage.removeItem(DISMISS_KEY)
  } catch {
    /* sin almacenamiento de sesión: se avisará en cada pantalla, no pasa nada */
  }
}

/** Pasos para instalar la app en el iPhone (las notificaciones solo funcionan con la app instalada). */
export function InstallSteps() {
  return (
    <ol className="space-y-2.5 text-sm text-gray-700" data-testid="install-steps">
      <li className="flex gap-3">
        <span className="w-6 h-6 rounded-full bg-blue-100 text-polyblue font-extrabold text-xs flex items-center justify-center flex-shrink-0">1</span>
        <span>En Safari toca el botón <b>Compartir</b> (el cuadrado con la flecha ⬆️, abajo en la pantalla).</span>
      </li>
      <li className="flex gap-3">
        <span className="w-6 h-6 rounded-full bg-blue-100 text-polyblue font-extrabold text-xs flex items-center justify-center flex-shrink-0">2</span>
        <span>Elige <b>«Agregar a pantalla de inicio»</b> ➕ y deja activado «Abrir como app web».</span>
      </li>
      <li className="flex gap-3">
        <span className="w-6 h-6 rounded-full bg-blue-100 text-polyblue font-extrabold text-xs flex items-center justify-center flex-shrink-0">3</span>
        <span>Abre <b>FamilyMarket desde el nuevo ícono</b> (no desde Safari) y toca «Activar notificaciones».</span>
      </li>
    </ol>
  )
}

/**
 * Cada vez que se abre la app, quien todavía no tiene las notificaciones activadas ve este aviso: puede activarlas o
 * decir «Ahora no» (vuelve a salir la próxima vez que abra la app). Si ya las tiene activas, no sale nunca más.
 */
export default function PushPrompt() {
  const { profile, needsPasswordChange, tourReplay } = useAuth()
  const { celebrations } = useGame()
  const [status, setStatus] = useState(null)
  const [dismissed, setDismissed] = useState(readDismissed)
  const [never, setNever] = useState(() => store.get(NEVER_KEY, false))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const refresh = useCallback(async () => setStatus(await syncPush()), [])

  // Al abrir la app: renueva la suscripción (si ya la tenía) y averigua en qué situación está este teléfono.
  useEffect(() => {
    if (profile?.id) refresh()
  }, [profile?.id, refresh])

  // Si vuelves a la app después de un buen rato, se vuelve a avisar.
  useEffect(() => {
    let hiddenAt = 0
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) {
        hiddenAt = 0
        writeDismissed(false)
        setDismissed(false)
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [refresh])

  const wanted = !!status && status !== 'active' && status !== 'unsupported' && !(status === 'old' && never)
  const blocked = needsPasswordChange || tourReplay || celebrations.length > 0

  useEffect(() => {
    if (!wanted || dismissed || blocked) {
      setOpen(false)
      return undefined
    }
    const timer = setTimeout(() => setOpen(true), 2500)
    return () => clearTimeout(timer)
  }, [wanted, dismissed, blocked])

  const close = () => {
    writeDismissed(true)
    setDismissed(true)
    setOpen(false)
    setMessage(null)
  }

  const activate = async () => {
    setBusy(true)
    setMessage(null)
    const result = await enablePush() // se llama directo desde el toque: iPhone lo exige
    setBusy(false)
    if (result.ok) {
      toast.success('¡Listo! Te avisaremos de mercados nuevos, cierres y resultados 🔔', { duration: 5000 })
      setStatus('active')
      setOpen(false)
    } else if (result.reason === 'denied') {
      setStatus('denied')
      setMessage('El permiso quedó bloqueado. Para recibir avisos tienes que permitirlo en el teléfono.')
    } else if (result.reason === 'dismissed') {
      setMessage('No diste el permiso. Si quieres recibir avisos, toca «Activar» y luego «Permitir».')
    } else {
      setMessage(result.message || 'No se pudo activar. Inténtalo de nuevo.')
    }
  }

  const recheck = async () => {
    setBusy(true)
    const next = await getPushStatus()
    setStatus(next)
    setBusy(false)
    if (next === 'active') setOpen(false)
    else setMessage('Todavía aparece bloqueado. Revisa los pasos y vuelve a tocar «Ya lo activé».')
  }

  const neverAgain = () => {
    store.set(NEVER_KEY, true)
    setNever(true)
    setOpen(false)
  }

  if (!wanted) return null

  return (
    <Sheet open={open} onClose={close} z="z-[60]">
      <div className="text-center pb-3" data-testid="push-prompt" data-status={status}>
        <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-blue-100 to-blue-300 flex items-center justify-center text-3xl shadow-md">
          <span aria-hidden="true">🔔</span>
        </div>

        {status === 'ask' && (
          <>
            <h2 className="text-xl font-extrabold text-gray-900 mt-3">Activa las notificaciones</h2>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Te avisamos cuando haya un <b>mercado nuevo</b>, cuando <b>cierren las apuestas</b> y cuando <b>ganes</b>. Así no te pierdes nada. Puedes elegir qué avisos quieres en Portafolio.
            </p>
          </>
        )}
        {status === 'denied' && (
          <>
            <h2 className="text-xl font-extrabold text-gray-900 mt-3">Las notificaciones están bloqueadas</h2>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">{unblockHelp()}</p>
            <p className="text-xs text-gray-500 mt-2">Cuando las permitas, toca «Ya lo activé».</p>
          </>
        )}
        {status === 'install' && (
          <>
            <h2 className="text-xl font-extrabold text-gray-900 mt-3">Instala la app para recibir avisos</h2>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed mb-4">
              En iPhone las notificaciones solo funcionan con FamilyMarket instalada en la pantalla de inicio (iOS 16.4 o más nuevo). Son 3 pasos:
            </p>
            <div className="text-left">
              <InstallSteps />
            </div>
          </>
        )}
        {status === 'old' && (
          <>
            <h2 className="text-xl font-extrabold text-gray-900 mt-3">Tu iPhone necesita actualizarse</h2>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Para recibir avisos hace falta iOS 16.4 o más nuevo: Ajustes → General → Actualización de software.
            </p>
          </>
        )}

        {message && (
          <p className="mt-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="alert">
            {message}
          </p>
        )}

        <div className="mt-5 space-y-2">
          {status === 'ask' && (
            <button
              onClick={activate}
              disabled={busy}
              className="w-full py-3.5 rounded-2xl bg-polyblue hover:bg-blue-700 text-white font-extrabold text-lg shadow-lg shadow-blue-500/20 tap-feedback disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Bell size={20} /> {busy ? 'Activando…' : 'Activar notificaciones'}
            </button>
          )}
          {status === 'denied' && (
            <button
              onClick={recheck}
              disabled={busy}
              className="w-full py-3.5 rounded-2xl bg-polyblue hover:bg-blue-700 text-white font-extrabold text-lg tap-feedback disabled:opacity-60"
            >
              {busy ? 'Revisando…' : 'Ya lo activé'}
            </button>
          )}
          <button onClick={close} className="w-full py-3 rounded-2xl text-gray-500 font-bold">
            {status === 'ask' || status === 'denied' ? 'Ahora no' : 'Entendido'}
          </button>
          {status === 'old' && (
            <button onClick={neverAgain} className="w-full py-2 text-xs font-semibold text-gray-400">
              No volver a mostrar en este teléfono
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
