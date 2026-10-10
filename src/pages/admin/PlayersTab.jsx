import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, Copy, KeyRound, LifeBuoy, Pencil, Plus, Search, Shield, ShieldCheck, Trash2, UserCheck, UserX, Wallet } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { copyText } from '../../lib/browser'
import { friendlyError, money } from '../../lib/format'
import { timeAgo } from '../../lib/time'
import { useConfirm } from '../../components/ConfirmDialog'
import { Avatar } from '../../components/Leaderboard'
import Sheet from '../../components/ui/Sheet'
import { Disclosure, Field, Notice, inputClass } from './adminUi'
import InvitesCard from './InvitesCard'
import SignupCard from './SignupCard'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

function RenameSheet({ player, onClose, onDone }) {
  const [name, setName] = useState(player.username || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const valid = USERNAME_RE.test(name.trim()) && name.trim() !== player.username
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await rpc('admin_rename_player', { p_user_id: player.id, p_username: name.trim() })
      toast.success(`Ahora se llama ${name.trim()}`, { duration: 4000 })
      onDone()
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={busy ? undefined : onClose} title={player.username} subtitle="Cambiar nombre">
      <div className="space-y-4 pb-4">
        <Field label="Nuevo nombre" hint="3-20 caracteres: letras, números o guion bajo (_).">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="none" autoCorrect="off" maxLength={20} className={inputClass} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <button onClick={save} disabled={!valid || busy} className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
          {busy ? 'Guardando…' : 'Guardar nombre'}
        </button>
      </div>
    </Sheet>
  )
}

/** Contraseña temporal fácil de dictar: 6 letras sin confusiones + 2 números. */
const randomPassword = () => {
  const letters = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const buf = new Uint32Array(8)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < 6; i += 1) out += letters[buf[i] % letters.length]
  for (let i = 6; i < 8; i += 1) out += digits[buf[i] % digits.length]
  return out
}

const accessMessage = (username, password, converted) =>
  `¡Hola${username ? ` ${username}` : ''}! Tu cuenta de FamilyMarket está lista de nuevo 🎯\n\n` +
  `Entra en: ${window.location.origin}/auth\n` +
  (username ? `Usuario: ${username}\n` : '') +
  `Contraseña temporal: ${password}\n\n` +
  (converted ? 'Ojo: ahora entras con tu NOMBRE DE USUARIO (el que sale en el ranking), ya no con el correo.\n' : '') +
  'Después de entrar, cámbiala por una que recuerdes en Portafolio → Mi cuenta.'

function PasswordSheet({ player, onClose, onDone }) {
  const [password, setPassword] = useState(randomPassword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await rpc('admin_reset_password', { p_user_id: player.id, p_new_password: password })
      setResult({ ...data, password })
      onDone?.(data)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    const ok = await copyText(accessMessage(result.username, result.password, result.converted))
    if (ok) toast.success('Mensaje copiado: pégalo en WhatsApp', { duration: 3500 })
    else toast.error('No se pudo copiar. Selecciónalo y cópialo a mano.')
  }
  return (
    <Sheet open onClose={busy ? undefined : onClose} title={player.username || 'Jugador'} subtitle="Restablecer contraseña">
      <div className="space-y-4 pb-4">
        {result ? (
          <>
            <Notice>
              Listo. <b>{result.username || 'Este jugador'}</b> ya puede entrar con esta contraseña temporal:
            </Notice>
            <div className="bg-gray-50 rounded-2xl py-4 px-3 text-center space-y-1">
              {result.username && (
                <p className="text-sm text-gray-500">
                  Usuario: <b className="text-gray-900 text-base" data-testid="reset-username">{result.username}</b>
                </p>
              )}
              <p className="text-3xl font-black tracking-wider font-mono select-all" data-testid="reset-password">
                {result.password}
              </p>
            </div>
            {result.converted && (
              <p className="text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-xl p-3">
                Antes entraba con su correo; <b>ahora entra con su nombre de usuario</b> y esta contraseña. Sus sesiones abiertas se cerrarán en unos minutos.
              </p>
            )}
            <button onClick={copy} className="w-full flex items-center justify-center gap-2 bg-polyblue text-white py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/20">
              <Copy size={18} /> Copiar mensaje para WhatsApp
            </button>
            <button onClick={onClose} className="w-full text-gray-500 font-semibold py-2">
              Cerrar
            </button>
          </>
        ) : (
          <>
            {player.login_kind === 'correo' && (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
                Esta persona entra hoy con su correo ({player.email_hint}). Al restablecer, <b>pasará a entrar con su nombre de usuario</b>.
              </p>
            )}
            <Field label="Contraseña temporal" hint="Mínimo 6 caracteres. Puedes escribir la que quieras o usar esta.">
              <div className="flex gap-2">
                <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoCapitalize="none" autoCorrect="off" className={`${inputClass} font-mono flex-1`} aria-label="Contraseña temporal" />
                <button type="button" onClick={() => setPassword(randomPassword())} className="px-3 rounded-xl bg-gray-100 text-sm font-bold text-gray-700">
                  Otra
                </button>
              </div>
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <button onClick={save} disabled={password.length < 6 || busy} className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
              {busy ? 'Guardando…' : 'Restablecer contraseña'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  )
}

function BalanceSheet({ player, onClose, onDone }) {
  const confirm = useConfirm()
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const value = parseFloat(String(amount).replace(',', '.'))
  const apply = async (sign) => {
    if (!(value > 0)) return
    const ok = await confirm({
      title: sign > 0 ? 'Agregar fondos' : 'Quitar fondos',
      message: `${sign > 0 ? 'Agregar' : 'Quitar'} ${money(value)} a ${player.username}.`,
      confirmText: sign > 0 ? 'Agregar' : 'Quitar',
    })
    if (!ok) return
    setBusy(true)
    try {
      await rpc('admin_update_balance', { p_user_id: player.id, p_amount: sign * value })
      toast.success('Saldo actualizado', { duration: 3500 })
      onDone()
      onClose()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={busy ? undefined : onClose} title={player.username} subtitle={`Saldo actual ${money(player.balance)}`}>
      <div className="space-y-4 pb-4">
        <Field label="Monto (USD)">
          <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="Ej: 50.00" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => apply(1)} disabled={busy || !(value > 0)} className="flex items-center justify-center gap-2 bg-emerald-500 text-white py-3.5 rounded-xl font-bold disabled:opacity-50">
            <Plus size={19} strokeWidth={2.6} /> Agregar
          </button>
          <button onClick={() => apply(-1)} disabled={busy || !(value > 0)} className="flex items-center justify-center gap-2 bg-rose-500 text-white py-3.5 rounded-xl font-bold disabled:opacity-50">
            <Trash2 size={19} strokeWidth={2.6} /> Quitar
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/** Personas que pidieron ayuda desde la pantalla de acceso (olvidaron su usuario o contraseña). */
function HelpRequestsCard({ players, onReset }) {
  const [requests, setRequests] = useState([])
  const load = useCallback(async () => {
    setRequests((await rpc('admin_list_help_requests')) || [])
  }, [])
  useEffect(() => {
    load().catch(() => {})
    const id = setInterval(() => load().catch(() => {}), 30000)
    return () => clearInterval(id)
  }, [load])

  if (requests.length === 0) return null
  const dismiss = async (id) => {
    try {
      await rpc('admin_handle_help_request', { p_id: id })
      load()
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }
  return (
    <div className="bg-amber-50 border-2 border-amber-200 rounded-3xl p-4 space-y-3" aria-label="Piden ayuda">
      <p className="font-extrabold text-amber-900 flex items-center gap-2">
        <LifeBuoy size={19} /> Piden ayuda ({requests.length})
      </p>
      <p className="text-xs text-amber-800">Olvidaron su usuario o su contraseña. Elige quién es y restablece: así no crean otra cuenta.</p>
      <ul className="space-y-2.5">
        {requests.map((r) => (
          <li key={r.id} className="bg-white rounded-2xl border border-amber-100 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">«{r.name}»</p>
                {r.note && <p className="text-xs text-gray-500 break-words">{r.note}</p>}
                <p className="text-[11px] text-gray-400">{timeAgo(r.created_at)}</p>
              </div>
              <button onClick={() => dismiss(r.id)} className="text-xs font-bold text-gray-400 flex-shrink-0">
                Descartar
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {(r.matches || []).length > 0 ? (
                r.matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onReset(players.find((x) => x.id === m.id) || { id: m.id, username: m.username }, r.id)
                    }}
                    className="px-3 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold"
                  >
                    Restablecer a {m.username}
                  </button>
                ))
              ) : (
                <p className="text-xs text-amber-800">No encontré a nadie con ese nombre. Búscalo en la lista de abajo y restablece desde ahí.</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function PlayersTab() {
  const { profile } = useAuth()
  const confirm = useConfirm()
  const [players, setPlayers] = useState(null)
  const [open, setOpen] = useState(null)
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState(null) // { kind: 'rename'|'password'|'balance', player }

  const load = useCallback(async () => {
    setPlayers((await rpc('admin_list_players')) || [])
  }, [])
  useEffect(() => {
    load().catch((e) => toast.error(friendlyError(e)))
  }, [load])

  const toggleModerator = async (p, value) => {
    setPlayers((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_moderator: value } : x)))
    try {
      await rpc('admin_set_moderator', { p_user_id: p.id, p_value: value })
      toast.success(value ? `${p.username} ahora es moderador` : `${p.username} ya no es moderador`, { duration: 3500 })
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
      load()
    }
  }

  const disable = async (p) => {
    const ok = await confirm({
      title: 'Deshabilitar jugador',
      message: `«${p.username}» dejará de aparecer en el ranking, ya no podrá entrar ni operar y su nombre quedará libre para que se registre de nuevo.\n\nSus acciones en mercados abiertos se conservan. Puedes rehabilitarlo cuando quieras.`,
      confirmText: 'Deshabilitar',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const r = await rpc('admin_disable_player', { p_user_id: p.id })
      toast.success(`${p.username} deshabilitado (ahora figura como ${r.username})`, { duration: 5000 })
      setOpen(null)
      load()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }
  const enable = async (p) => {
    try {
      const r = await rpc('admin_enable_player', { p_user_id: p.id })
      toast.success(`${r.username} rehabilitado`, { duration: 4000 })
      load()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }
  const remove = async (p) => {
    const ok = await confirm({
      title: 'Eliminar para siempre',
      message: `Se borrarán la cuenta de «${p.original_username || p.username}», sus operaciones, avisos y acciones (también las de mercados abiertos).\n\nNo se puede deshacer.`,
      confirmText: 'Eliminar definitivamente',
      tone: 'danger',
    })
    if (!ok) return
    try {
      const r = await rpc('admin_delete_player', { p_user_id: p.id })
      toast.success(`Jugador eliminado${r.open_positions_removed ? ` (${r.open_positions_removed} posición(es) abiertas desaparecieron)` : ''}`, { duration: 5000 })
      setOpen(null)
      load()
    } catch (err) {
      toast.error(friendlyError(err), { duration: 6000 })
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!players) return null
    return q ? players.filter((p) => `${p.username || ''} ${p.original_username || ''} ${p.email_hint || ''}`.toLowerCase().includes(q)) : players
  }, [players, query])
  const active = shown?.filter((p) => !p.disabled_at) ?? []
  const disabled = shown?.filter((p) => p.disabled_at) ?? []

  const renderRow = (p) => {
    const expanded = open === p.id
    const me = p.id === profile?.id
    return (
      <div key={p.id} className={p.disabled_at ? 'bg-gray-50' : ''}>
        <div className="flex items-center gap-2 pr-3">
          <button onClick={() => setOpen(expanded ? null : p.id)} className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 py-3.5 text-left" aria-expanded={expanded}>
            <Avatar name={p.username || '?'} size={40} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-bold truncate ${p.disabled_at ? 'text-gray-400' : 'text-gray-900'}`}>{p.username || '(sin nombre)'}</span>
                {p.is_admin && <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Dueño</span>}
                {p.disabled_at && <span className="text-[10px] font-bold uppercase bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">Deshabilitado</span>}
                {p.needs_password_change && <span className="text-[10px] font-bold uppercase bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">Clave temporal</span>}
              </div>
              <p className="text-xs text-gray-500 tabular-nums truncate">
                Efectivo {money(p.balance)}
                {p.login_kind === 'correo' && p.email_hint ? ` · entra con correo ${p.email_hint}` : ''}
              </p>
            </div>
            <ChevronDown size={18} className={`text-gray-300 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          {!p.is_admin && !p.disabled_at && (
            <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => toggleModerator(p, !p.is_moderator)}
                aria-pressed={!!p.is_moderator}
                aria-label={p.is_moderator ? `Quitar de moderador a ${p.username}` : `Hacer moderador a ${p.username}`}
                className={`w-12 h-7 flex items-center rounded-full p-0.5 transition-colors ${p.is_moderator ? 'bg-polyblue' : 'bg-gray-300'}`}
              >
                <span className={`bg-white w-6 h-6 rounded-full shadow transition-transform ${p.is_moderator ? 'translate-x-5' : ''}`} />
              </button>
              <span className={`text-[10px] font-bold ${p.is_moderator ? 'text-polyblue' : 'text-gray-400'}`}>Moderador</span>
            </div>
          )}
        </div>
        {expanded && (
          <div className="px-4 pb-4 space-y-3 animate-fade-in">
            {!p.disabled_at ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => setSheet({ kind: 'rename', player: p })} className="flex flex-col items-center gap-1 py-3 rounded-xl bg-gray-50 text-gray-700 text-xs font-bold">
                    <Pencil size={18} /> Nombre
                  </button>
                  <button onClick={() => setSheet({ kind: 'password', player: p })} className="flex flex-col items-center gap-1 py-3 rounded-xl bg-gray-50 text-gray-700 text-xs font-bold">
                    <KeyRound size={18} /> Contraseña
                  </button>
                  <button onClick={() => setSheet({ kind: 'balance', player: p })} className="flex flex-col items-center gap-1 py-3 rounded-xl bg-gray-50 text-gray-700 text-xs font-bold">
                    <Wallet size={18} /> Saldo
                  </button>
                </div>
                {!p.is_admin && (
                  <button onClick={() => disable(p)} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-red-200 text-red-600 text-sm font-bold">
                    <UserX size={17} /> Deshabilitar jugador
                  </button>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => enable(p)} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-bold">
                  <UserCheck size={17} /> Rehabilitar
                </button>
                <button onClick={() => remove(p)} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white border border-red-200 text-red-600 text-sm font-bold">
                  <Trash2 size={17} /> Eliminar para siempre
                </button>
              </div>
            )}
            {me && (
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <ShieldCheck size={13} /> Esta eres tú
              </p>
            )}
            {!me && p.is_admin && (
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Shield size={13} /> Dueño
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <HelpRequestsCard players={players || []} onReset={(player) => setSheet({ kind: 'password', player })} />

      <SignupCard />

      <Disclosure title="Invitar por correo (opcional)" hint="Solo si alguien prefiere entrar con Google o con su correo">
        <InvitesCard />
      </Disclosure>

      <Notice>
        <span className="block font-semibold">Moderadores</span>
        Pueden crear y resolver mercados, revisar sugerencias y ver el registro de actividad. Anular mercados, deshacer resoluciones, saldos y
        reinicios son solo tuyos.
      </Notice>

      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar jugador…"
          aria-label="Buscar jugador"
          className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-gray-200 focus:border-polyblue outline-none bg-white"
        />
      </div>

      {!players && <div className="skeleton h-40 rounded-2xl" />}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100 overflow-hidden">{active.map(renderRow)}</div>

      {disabled.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-wider text-gray-400">Deshabilitados ({disabled.length})</p>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">{disabled.map(renderRow)}</div>
        </div>
      )}

      {sheet?.kind === 'rename' && <RenameSheet player={sheet.player} onClose={() => setSheet(null)} onDone={load} />}
      {sheet?.kind === 'password' && <PasswordSheet player={sheet.player} onClose={() => setSheet(null)} onDone={load} />}
      {sheet?.kind === 'balance' && <BalanceSheet player={sheet.player} onClose={() => setSheet(null)} onDone={load} />}
    </div>
  )
}
