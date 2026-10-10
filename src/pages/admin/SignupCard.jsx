import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, KeyRound, RefreshCw, Share2, UserPlus } from 'lucide-react'
import { rpc } from '../../lib/api'
import { formatCode } from '../../lib/accounts'
import { copyText } from '../../lib/browser'
import { friendlyError } from '../../lib/format'
import { useConfirm } from '../../components/ConfirmDialog'
import { Card } from './adminUi'

/** Mensaje listo para pegar en el grupo de WhatsApp: el link ya lleva el código puesto. */
export const inviteMessage = (code) =>
  `¡Te invito a FamilyMarket! 🎯\n\n` +
  `1) Abre este enlace en tu celular:\n${window.location.origin}/auth?codigo=${code}\n` +
  `2) Elige tu nombre de jugador y una contraseña (el código ya viene escrito: ${formatCode(code)}).\n` +
  `3) Haz el mini-tutorial (2 minutos) y listo: ¡empiezas con $1,000!\n\n` +
  `Si olvidas tu contraseña, avísame y te la restablezco.`

/** Registro de jugadores: un código para toda la familia, sin pedir correos a nadie. */
export default function SignupCard() {
  const confirm = useConfirm()
  const [info, setInfo] = useState(null)
  const [max, setMax] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const data = await rpc('admin_get_signup')
    setInfo(data)
    setMax(String(data.max_players))
  }, [])
  useEffect(() => {
    load().catch((e) => toast.error(friendlyError(e)))
  }, [load])

  const run = async (fn, okMessage) => {
    setBusy(true)
    try {
      const data = await fn()
      setInfo(data)
      setMax(String(data.max_players))
      if (okMessage) toast.success(okMessage, { duration: 3000 })
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    } finally {
      setBusy(false)
    }
  }

  const copyInvite = async () => {
    if (await copyText(inviteMessage(info.code))) toast.success('Invitación copiada: pégala en el grupo de WhatsApp', { duration: 4000 })
    else toast.error('No se pudo copiar. Selecciona el código y cópialo a mano.')
  }
  const share = async () => {
    try {
      await navigator.share({ text: inviteMessage(info.code) })
    } catch {
      /* cancelado o sin soporte */
    }
  }
  const rotate = async () => {
    const ok = await confirm({
      title: 'Cambiar el código',
      message: 'El código anterior deja de funcionar. Quienes ya tienen cuenta no se ven afectados.',
      confirmText: 'Cambiar código',
    })
    if (ok) run(() => rpc('admin_rotate_signup_code'), 'Código nuevo listo')
  }

  const maxValue = parseInt(max, 10)
  const maxValid = Number.isInteger(maxValue) && maxValue >= 1 && maxValue <= 500

  return (
    <Card title="Registro de jugadores" subtitle={info ? `${info.players} de ${info.max_players} jugadores` : 'Cargando…'} icon={<UserPlus size={22} />} tone="bg-emerald-600">
      {info && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Para que entre alguien nuevo, mándale el enlace con el código. Elige su nombre y su contraseña desde su celular, sin correos.
          </p>

          <div className="bg-gray-50 rounded-2xl border border-gray-200 py-4 px-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Código de la familia</p>
            <p className="text-3xl font-black font-mono tracking-widest text-gray-900 select-all mt-1" aria-label="Código de la familia">
              {formatCode(info.code)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={copyInvite} className="col-span-2 flex items-center justify-center gap-2 bg-polyblue text-white py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/20 tap-feedback">
              <Copy size={18} /> Copiar invitación para WhatsApp
            </button>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button onClick={share} className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold">
                <Share2 size={17} /> Compartir
              </button>
            )}
            <button onClick={rotate} disabled={busy} className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold disabled:opacity-50">
              <RefreshCw size={17} /> Cambiar código
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3">
            <div className="min-w-0">
              <p className="font-bold text-gray-900">Registro {info.is_open ? 'abierto' : 'cerrado'}</p>
              <p className="text-xs text-gray-500">{info.is_open ? 'Cualquiera con el código puede crear su cuenta.' : 'Nadie nuevo puede entrar, aunque tenga el código.'}</p>
            </div>
            <button
              type="button"
              onClick={() => run(() => rpc('admin_set_signup', { p_open: !info.is_open }), info.is_open ? 'Registro cerrado' : 'Registro abierto')}
              aria-pressed={info.is_open}
              aria-label={info.is_open ? 'Cerrar el registro' : 'Abrir el registro'}
              disabled={busy}
              className={`w-12 h-7 flex-shrink-0 flex items-center rounded-full p-0.5 transition-colors ${info.is_open ? 'bg-polygreen' : 'bg-gray-300'}`}
            >
              <span className={`bg-white w-6 h-6 rounded-full shadow transition-transform ${info.is_open ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label htmlFor="max-players" className="block text-sm font-bold text-gray-700 mb-1.5">
                Máximo de jugadores
              </label>
              <input
                id="max-players"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-polyblue outline-none bg-white"
              />
            </div>
            <button
              onClick={() => run(() => rpc('admin_set_signup', { p_open: info.is_open, p_max: maxValue }), 'Máximo guardado')}
              disabled={busy || !maxValid || maxValue === info.max_players}
              className="px-4 py-3 rounded-xl bg-gray-900 text-white font-bold disabled:opacity-40"
            >
              Guardar
            </button>
          </div>
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <KeyRound size={13} /> Si alguien olvida su contraseña: abre su nombre más abajo y toca «Contraseña».
          </p>
        </div>
      )}
    </Card>
  )
}
