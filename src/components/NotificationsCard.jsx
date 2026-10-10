import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Bell, BellOff, BellRing } from 'lucide-react'
import { rpc } from '../lib/api'
import { friendlyError } from '../lib/format'
import { disablePush, enablePush, getPushStatus, unblockHelp } from '../lib/push'
import { InstallSteps } from './PushPrompt'

const OPTIONS = [
  ['new_markets', 'Mercados nuevos', 'Cuando se publica o abre un mercado'],
  ['closing', 'Cierres', 'Cuando cierran las apuestas y la «última llamada» (de los mercados donde tienes acciones)'],
  ['results', 'Resultados y premios', 'Cuando ganas, pierdes o recibes un premio sorpresa'],
  ['suggestions', 'Mis sugerencias', 'Cuando aprueban o rechazan lo que sugeriste'],
]

function Switch({ on, onChange, label, hint, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="w-full flex items-center justify-between gap-3 py-3 text-left disabled:opacity-60"
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500 leading-snug">{hint}</span>
      </span>
      <span className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors ${on ? 'bg-polygreen' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  )
}

/** Portafolio → Notificaciones: activar o desactivar los avisos en este teléfono y elegir cuáles quiere. */
export default function NotificationsCard() {
  const [status, setStatus] = useState(null)
  const [prefs, setPrefs] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    setStatus(await getPushStatus())
    try {
      const state = await rpc('get_push_state')
      setPrefs(state?.prefs || null)
    } catch {
      setPrefs(null)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const activate = async () => {
    setBusy(true)
    setMessage(null)
    const result = await enablePush() // directo desde el toque (iPhone lo exige)
    setBusy(false)
    if (result.ok) {
      toast.success('¡Listo! Te avisaremos 🔔', { duration: 4000 })
      load()
    } else if (result.reason === 'denied') {
      setStatus('denied')
    } else if (result.reason === 'dismissed') {
      setMessage('No diste el permiso. Toca «Activar» y luego «Permitir».')
    } else {
      setMessage(result.message || 'No se pudo activar. Inténtalo de nuevo.')
    }
  }

  const deactivate = async () => {
    setBusy(true)
    await disablePush()
    setBusy(false)
    load()
  }

  const changePref = async (key, value) => {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      await rpc('set_push_prefs', { p_new_markets: next.new_markets, p_closing: next.closing, p_results: next.results, p_suggestions: next.suggestions })
    } catch (err) {
      setPrefs(prefs)
      toast.error(friendlyError(err))
    }
  }

  const sendTest = async () => {
    setBusy(true)
    try {
      await rpc('push_send_test')
      toast.success('Prueba enviada: debería llegarte en unos segundos', { duration: 5000 })
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Notificaciones" data-testid="notifications-card">
      <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Notificaciones</h2>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card p-4">
        {!status && <p className="text-sm text-gray-400">Revisando…</p>}

        {status === 'active' && (
          <>
            <div className="flex items-center gap-2.5 mb-1">
              <span className="w-9 h-9 rounded-full bg-emerald-50 text-polygreen flex items-center justify-center">
                <BellRing size={18} />
              </span>
              <div>
                <p className="font-bold text-gray-900 leading-tight">Activadas en este teléfono</p>
                <p className="text-xs text-gray-500">Elige qué avisos quieres recibir:</p>
              </div>
            </div>
            {prefs && (
              <div className="divide-y divide-gray-100 mt-1">
                {OPTIONS.map(([key, label, hint]) => (
                  <Switch key={key} on={!!prefs[key]} onChange={(v) => changePref(key, v)} label={label} hint={hint} />
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button onClick={sendTest} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold border bg-white border-gray-200 text-polyblue disabled:opacity-60">
                Enviar una prueba
              </button>
              <button onClick={deactivate} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold border bg-white border-gray-200 text-gray-500 disabled:opacity-60 flex items-center justify-center gap-1.5">
                <BellOff size={15} /> Desactivar
              </button>
            </div>
          </>
        )}

        {status === 'ask' && (
          <>
            <p className="text-sm text-gray-600 leading-relaxed">
              Recibe un aviso cuando haya un <b>mercado nuevo</b>, cuando <b>cierren las apuestas</b> y cuando <b>ganes</b>.
            </p>
            <button onClick={activate} disabled={busy} className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold bg-polyblue text-white disabled:opacity-60">
              <Bell size={17} /> {busy ? 'Activando…' : 'Activar notificaciones'}
            </button>
          </>
        )}

        {status === 'denied' && (
          <>
            <p className="font-bold text-gray-900">Las notificaciones están bloqueadas</p>
            <p className="text-sm text-gray-600 mt-1 leading-relaxed">{unblockHelp()}</p>
            <button onClick={load} className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold border bg-white border-gray-200 text-polyblue">
              Ya lo activé
            </button>
          </>
        )}

        {status === 'install' && (
          <>
            <p className="font-bold text-gray-900">Instala la app para recibir avisos</p>
            <p className="text-sm text-gray-600 mt-1 mb-3">En iPhone hace falta iOS 16.4 o más nuevo y tener FamilyMarket en la pantalla de inicio:</p>
            <InstallSteps />
          </>
        )}

        {status === 'old' && (
          <p className="text-sm text-gray-600 leading-relaxed">
            Para recibir avisos tu iPhone necesita iOS 16.4 o más nuevo (Ajustes → General → Actualización de software).
          </p>
        )}

        {status === 'unsupported' && (
          <p className="text-sm text-gray-600 leading-relaxed">
            Este navegador no permite notificaciones. En Android prueba con Chrome; en iPhone instala la app desde Safari.
          </p>
        )}

        {message && (
          <p className="mt-3 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="alert">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
