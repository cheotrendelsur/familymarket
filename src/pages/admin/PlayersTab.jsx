import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ChevronDown, KeyRound, Pencil, Plus, Shield, ShieldCheck, Trash2, Wallet } from 'lucide-react'
import { rpc } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { friendlyError, money } from '../../lib/format'
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

const randomPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  const buf = new Uint32Array(8)
  crypto.getRandomValues(buf)
  for (const n of buf) out += chars[n % chars.length]
  return out
}

function PasswordSheet({ player, onClose }) {
  const [password, setPassword] = useState(randomPassword)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [doneWith, setDoneWith] = useState(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await rpc('admin_reset_password', { p_user_id: player.id, p_new_password: password })
      setDoneWith(password)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open onClose={busy ? undefined : onClose} title={player.username} subtitle="Restablecer contraseña">
      <div className="space-y-4 pb-4">
        {doneWith ? (
          <>
            <Notice>
              Listo. La nueva contraseña de <b>{player.username}</b> es:
            </Notice>
            <p className="text-center text-3xl font-black tracking-wider font-mono bg-gray-50 rounded-2xl py-5 select-all">{doneWith}</p>
            <p className="text-sm text-gray-500 text-center">Pásasela por WhatsApp. Sus sesiones abiertas se cerraron.</p>
            <button onClick={onClose} className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg">
              Entendido
            </button>
          </>
        ) : (
          <>
            <Field label="Nueva contraseña" hint="Mínimo 6 caracteres. Puedes escribir la que quieras o usar esta.">
              <div className="flex gap-2">
                <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoCapitalize="none" autoCorrect="off" className={`${inputClass} font-mono flex-1`} />
                <button type="button" onClick={() => setPassword(randomPassword())} className="px-3 rounded-xl bg-gray-100 text-sm font-bold text-gray-700">
                  Otra
                </button>
              </div>
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <button onClick={save} disabled={password.length < 6 || busy} className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
              {busy ? 'Guardando…' : 'Cambiar contraseña'}
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

export default function PlayersTab() {
  const { profile } = useAuth()
  const [players, setPlayers] = useState(null)
  const [open, setOpen] = useState(null)
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

  return (
    <div className="space-y-4">
      <SignupCard />

      <Disclosure title="Invitar por correo (opcional)" hint="Solo si alguien prefiere entrar con Google o con su correo">
        <InvitesCard />
      </Disclosure>

      <Notice>
        <span className="block font-semibold">Moderadores</span>
        Pueden crear y resolver mercados, revisar sugerencias y ver el registro de actividad. Anular mercados, deshacer resoluciones, saldos y
        reinicios son solo tuyos.
      </Notice>

      {!players && <div className="skeleton h-40 rounded-2xl" />}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-card divide-y divide-gray-100 overflow-hidden">
        {players?.map((p) => {
          const expanded = open === p.id
          const me = p.id === profile?.id
          return (
            <div key={p.id}>
              <div className="flex items-center gap-2 pr-3">
                <button onClick={() => setOpen(expanded ? null : p.id)} className="flex-1 min-w-0 flex items-center gap-3 pl-4 pr-1 py-3.5 text-left" aria-expanded={expanded}>
                  <Avatar name={p.username || '?'} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 truncate">{p.username || '(sin nombre)'}</span>
                      {p.is_admin && <span className="text-[10px] font-bold uppercase bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">Dueño</span>}
                    </div>
                    <p className="text-xs text-gray-500 tabular-nums">Efectivo {money(p.balance)}</p>
                  </div>
                  <ChevronDown size={18} className={`text-gray-300 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {!p.is_admin && (
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
        })}
      </div>

      {sheet?.kind === 'rename' && <RenameSheet player={sheet.player} onClose={() => setSheet(null)} onDone={load} />}
      {sheet?.kind === 'password' && <PasswordSheet player={sheet.player} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'balance' && <BalanceSheet player={sheet.player} onClose={() => setSheet(null)} onDone={load} />}
    </div>
  )
}
