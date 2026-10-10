import { useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound } from 'lucide-react'
import { auth, rpc } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { friendlyAuthError } from '../lib/format'
import Sheet from './ui/Sheet'

const inputClass =
  'w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-polyblue focus:ring-4 focus:ring-polyblue/10 outline-none transition bg-white'

/** El propio jugador elige su contraseña (por ejemplo, después de entrar con la temporal que le dio el dueño). */
export function ChangePasswordSheet({ open, onClose }) {
  const { profile, refreshProfile } = useAuth()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const valid = password.length >= 6 && password === again

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const { error: updateError } = await auth.updatePassword(password)
      if (updateError) throw updateError
      await rpc('password_changed')
      await refreshProfile()
      toast.success('Listo: esa es tu contraseña nueva', { duration: 5000 })
      setPassword('')
      setAgain('')
      onClose()
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={busy ? undefined : onClose} title="Cambiar mi contraseña" subtitle={profile?.username ? `Tu usuario: ${profile.username}` : undefined}>
      <div className="space-y-4 pb-4">
        <div>
          <label htmlFor="new-pw" className="block text-sm font-bold text-gray-700 mb-1.5">
            Contraseña nueva
          </label>
          <input id="new-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="Mínimo 6 caracteres" />
        </div>
        <div>
          <label htmlFor="new-pw2" className="block text-sm font-bold text-gray-700 mb-1.5">
            Repítela
          </label>
          <input id="new-pw2" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} />
          {again && password !== again && <p className="text-xs text-red-600 mt-1.5 font-semibold">No coinciden</p>}
        </div>
        <p className="text-xs text-gray-500">Elige una que recuerdes (o déjala guardada en tu celular). Tu usuario es el nombre con el que sales en el ranking.</p>
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3" role="alert">
            {error}
          </p>
        )}
        <button onClick={save} disabled={!valid || busy} className="w-full bg-polyblue text-white py-4 rounded-2xl font-bold text-lg disabled:opacity-50">
          {busy ? 'Guardando…' : 'Guardar mi contraseña'}
        </button>
      </div>
    </Sheet>
  )
}

/** Aviso mientras la persona sigue usando la contraseña temporal que le dio el dueño. */
export function PasswordBanner() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  if (!profile?.needs_password_change) return null
  return (
    <>
      <div className="max-w-5xl mx-auto px-4 pt-3">
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3" role="status">
          <KeyRound size={20} className="text-amber-700 flex-shrink-0" />
          <p className="flex-1 text-sm text-amber-900 font-semibold">Estás usando una contraseña temporal. Elige la tuya para no olvidarla.</p>
          <button onClick={() => setOpen(true)} className="flex-shrink-0 bg-amber-500 text-white font-bold text-sm px-3.5 py-2 rounded-xl">
            Elegirla
          </button>
        </div>
      </div>
      <ChangePasswordSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
