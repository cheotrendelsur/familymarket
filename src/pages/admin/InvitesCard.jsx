import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, Copy, KeyRound, Mail, Trash2, UserPlus } from 'lucide-react'
import { rpc } from '../../lib/api'
import { copyText } from '../../lib/browser'
import { friendlyError } from '../../lib/format'
import { useConfirm } from '../../components/ConfirmDialog'
import Sheet from '../../components/ui/Sheet'
import { Card, Field, Notice, inputClass } from './adminUi'

const inviteMessage = () =>
  `¡Te invito a FamilyMarket! 🎯\n\n` +
  `1) Abre este enlace en Safari (iPhone) o en Chrome (Android), no dentro de WhatsApp:\n${window.location.origin}\n` +
  `2) Toca «Continuar con Google» y elige el correo que me diste.\n` +
  `3) Escribe tu nombre de jugador y haz el mini-tutorial (2 minutos). ¡Empiezas con $1,000!`

/** Quién puede crear cuenta: el dueño agrega correos; cualquier otro queda fuera (lo exige la base de datos). */
export default function InvitesCard() {
  const confirm = useConfirm()
  const [invites, setInvites] = useState(null)
  const [sheet, setSheet] = useState(false)
  const [showJoined, setShowJoined] = useState(false)

  const load = useCallback(async () => {
    setInvites((await rpc('admin_list_invites')) || [])
  }, [])
  useEffect(() => {
    load().catch((e) => toast.error(friendlyError(e)))
  }, [load])

  const pending = invites?.filter((i) => !i.joined) ?? []
  const joined = invites?.filter((i) => i.joined) ?? []

  const copyMessage = async () => {
    if (await copyText(inviteMessage())) toast.success('Mensaje copiado: pégalo en WhatsApp', { duration: 3500 })
    else toast.error('No se pudo copiar. Selecciónalo y cópialo a mano.')
  }

  const togglePassword = async (item) => {
    try {
      await rpc('admin_set_invite_password', { p_email: item.email, p_value: !item.password_ok })
      toast.success(item.password_ok ? 'Ahora solo entra con Google' : 'Ahora también puede usar contraseña', { duration: 3000 })
      load()
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  const remove = async (item) => {
    const ok = await confirm({ title: 'Quitar invitación', message: `${item.email} ya no podrá crear cuenta.`, confirmText: 'Quitar', tone: 'danger' })
    if (!ok) return
    try {
      await rpc('admin_remove_invite', { p_email: item.email })
      load()
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  return (
    <Card
      title="Invitar jugadores"
      subtitle={invites ? `${joined.length} dentro · ${pending.length} esperando` : 'Cargando…'}
      icon={<Mail size={22} />}
    >
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          Solo pueden crear cuenta los correos de esta lista. Entran con <b>Google</b> (un toque, sin contraseñas ni correos de confirmación).
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSheet(true)} className="flex items-center justify-center gap-2 bg-polyblue text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-500/20">
            <UserPlus size={18} /> Invitar jugadores
          </button>
          <button onClick={copyMessage} className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold">
            <Copy size={17} /> Copiar mensaje
          </button>
        </div>

        {pending.length > 0 && (
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-2xl overflow-hidden" aria-label="Invitaciones pendientes">
            {pending.map((item) => (
              <li key={item.email} className="flex items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{item.email}</p>
                  <p className="text-[11px] text-gray-400">{item.password_ok ? 'Google o contraseña' : 'Solo Google'} · esperando que entre</p>
                </div>
                <button
                  onClick={() => togglePassword(item)}
                  aria-pressed={item.password_ok}
                  aria-label={item.password_ok ? `Quitar contraseña a ${item.email}` : `Permitir contraseña a ${item.email}`}
                  title={item.password_ok ? 'Puede usar contraseña' : 'Permitir también contraseña'}
                  className={`p-2 rounded-lg ${item.password_ok ? 'bg-blue-50 text-polyblue' : 'bg-gray-50 text-gray-400'}`}
                >
                  <KeyRound size={17} />
                </button>
                <button onClick={() => remove(item)} aria-label={`Quitar a ${item.email}`} className="p-2 rounded-lg bg-gray-50 text-gray-400 hover:text-red-600">
                  <Trash2 size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {joined.length > 0 && (
          <div>
            <button onClick={() => setShowJoined(!showJoined)} aria-expanded={showJoined} className="flex items-center gap-1 text-sm font-semibold text-gray-500">
              Ya están dentro ({joined.length}) <ChevronDown size={16} className={`transition-transform ${showJoined ? 'rotate-180' : ''}`} />
            </button>
            {showJoined && (
              <ul className="mt-2 text-sm text-gray-600 space-y-1 animate-fade-in">
                {joined.map((item) => (
                  <li key={item.email} className="flex justify-between gap-3">
                    <span className="truncate">{item.email}</span>
                    <span className="font-semibold text-gray-800 flex-shrink-0">{item.username || '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {sheet && <InviteSheet onClose={() => setSheet(false)} onDone={load} />}
    </Card>
  )
}

function InviteSheet({ onClose, onDone }) {
  const [text, setText] = useState('')
  const [withPassword, setWithPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const emails = text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await rpc('admin_invite_emails', { p_emails: emails, p_password_ok: withPassword })
      setResult(data)
      onDone()
      if (!data.invalid?.length) setText('')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={busy ? undefined : onClose} title="Invitar jugadores" subtitle="Escribe los correos de Google de cada persona">
      <div className="space-y-4 pb-4">
        <Field label="Correos" hint="Uno por línea, o separados por coma. Tiene que ser el correo con el que entrarán a Google.">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            aria-label="Correos"
            placeholder={'ana@gmail.com\nluis@gmail.com'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${inputClass} resize-none font-mono text-sm`}
          />
        </Field>
        <label className="flex items-start gap-3 bg-gray-50 rounded-xl p-3 cursor-pointer">
          <input type="checkbox" checked={withPassword} onChange={(e) => setWithPassword(e.target.checked)} className="mt-1 w-5 h-5 accent-polyblue" />
          <span className="text-sm text-gray-700">
            <b>También permitir contraseña</b>
            <span className="block text-xs text-gray-500">Solo para quien no pueda usar Google. Entrará con ese correo y una contraseña que elija.</span>
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        {result && (
          <Notice tone={result.invalid?.length ? 'error' : 'ok'}>
            {result.added} agregado{result.added === 1 ? '' : 's'}
            {result.already ? ` · ${result.already} ya estaba${result.already === 1 ? '' : 'n'}` : ''}
            {result.invalid?.length ? ` · no son correos válidos: ${result.invalid.join(', ')}` : ''}
          </Notice>
        )}
        <button onClick={save} disabled={busy || emails.length === 0} className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
          {busy ? 'Guardando…' : `Agregar a la lista${emails.length ? ` (${emails.length})` : ''}`}
        </button>
        <button onClick={onClose} className="w-full text-gray-500 font-semibold py-2">
          Cerrar
        </button>
      </div>
    </Sheet>
  )
}
