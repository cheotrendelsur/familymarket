import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Eye, EyeOff, LifeBuoy, Loader } from 'lucide-react'
import { auth, rpc } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { USERNAME_RE, formatCode, loginEmail, normalizeCode, playerEmail } from '../lib/accounts'
import { copyText, inAppBrowser } from '../lib/browser'
import { friendlyAuthError } from '../lib/format'
import { store } from '../lib/storage'

const inputClass =
  'w-full px-4 py-3 rounded-lg border-2 border-gray-300 focus:border-polyblue focus:ring-4 focus:ring-polyblue focus:ring-opacity-10 outline-none transition'

const REASONS = {
  closed: 'El registro está cerrado por ahora. Pídele a Cheche que lo abra.',
  locked: 'Hubo demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  bad_code: 'Ese código no es correcto. Revisa el mensaje del grupo de la familia.',
  full: 'Ya se completó el cupo de jugadores.',
  username_invalid: 'Tu nombre debe tener de 3 a 20 letras, números o guion bajo (_).',
  username_taken: 'Ese nombre ya está en uso. Elige otro.',
}

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/** Errores que Supabase deja en la dirección cuando falla el regreso desde Google (?error=...&error_description=...). */
function readOAuthError() {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    const raw = hash.get('error_description') || query.get('error_description') || hash.get('error') || query.get('error')
    if (!raw) return null
    return friendlyAuthError({ message: raw.replace(/\+/g, ' ') }, 'google')
  } catch {
    return null
  }
}

function PasswordField({ id, label, value, onChange, autoComplete, hint }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-gray-700 mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          required
          minLength={6}
          className={`${inputClass} pr-12`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500"
          aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {show ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      </div>
      {hint && <p className="text-xs text-gray-500 mt-1.5">{hint}</p>}
    </div>
  )
}

export default function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, signIn, signUp, signInWithGoogle } = useAuth()
  const urlCode = normalizeCode(new URLSearchParams(location.search).get('codigo') || new URLSearchParams(location.search).get('c'))
  const [mode, setMode] = useState(urlCode ? 'signup' : 'login') // 'login' | 'signup'
  const [googleOn, setGoogleOn] = useState(false)
  const [status, setStatus] = useState(null) // { open, full } del registro
  // entrar
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  // registro
  const [code, setCode] = useState(urlCode ? formatCode(urlCode) : '')
  const [username, setUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [nameHint, setNameHint] = useState(null) // null | 'ok' | 'taken' | 'invalid'
  const [similar, setSimilar] = useState([]) // jugadores con nombre parecido (posible duplicado)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpName, setHelpName] = useState('')
  const [helpNote, setHelpNote] = useState('')
  const [helpBusy, setHelpBusy] = useState(false)
  const [helpDone, setHelpDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState(() => {
    const notice = store.get('fm_notice', null)
    if (notice) store.set('fm_notice', null)
    return notice || readOAuthError()
  })
  const [waiting, setWaiting] = useState(null)
  const [copied, setCopied] = useState(false)
  const nameTimer = useRef(null)
  const embedded = inAppBrowser()

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  useEffect(() => {
    let active = true
    auth.googleEnabled().then((on) => active && setGoogleOn(on))
    rpc('signup_status')
      .then((s) => active && setStatus(s))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Limpia ?error=... de la dirección para que no reaparezca al recargar.
  useEffect(() => {
    if (error && (location.search || location.hash)) navigate('/auth', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Aviso en vivo de si el nombre está libre.
  useEffect(() => {
    clearTimeout(nameTimer.current)
    const v = username.trim()
    if (!v) {
      setNameHint(null)
      return undefined
    }
    if (!USERNAME_RE.test(v)) {
      setNameHint('invalid')
      return undefined
    }
    setNameHint(null)
    nameTimer.current = setTimeout(async () => {
      try {
        const r = await rpc('username_available', { p_username: v })
        setNameHint(r?.available ? 'ok' : 'taken')
      } catch {
        setNameHint(null)
      }
    }, 450)
    return () => clearTimeout(nameTimer.current)
  }, [username])

  // Aviso «ya existe alguien parecido»: evita que quien olvidó su cuenta cree otra nueva
  useEffect(() => {
    const v = username.trim()
    const c = normalizeCode(code)
    if (mode !== 'signup' || c.length < 8 || !USERNAME_RE.test(v)) {
      setSimilar([])
      return undefined
    }
    let active = true
    const t = setTimeout(async () => {
      try {
        const r = await rpc('similar_players', { p_code: c, p_username: v })
        if (active) setSimilar(Array.isArray(r) ? r : [])
      } catch {
        if (active) setSimilar([])
      }
    }, 600)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [mode, code, username])

  const openHelp = (name = '') => {
    setHelpName(name)
    setHelpDone(false)
    setHelpOpen(true)
    setMode('login')
    setError(null)
  }

  const sendHelp = async (e) => {
    e.preventDefault()
    if (helpBusy) return
    setHelpBusy(true)
    setError(null)
    try {
      const r = await rpc('request_help', { p_name: helpName.trim(), p_note: helpNote.trim() || null })
      if (!r?.ok) {
        setError(r?.reason === 'locked' ? 'Hay muchas solicitudes ahora mismo. Intenta de nuevo en un rato o escríbele a Cheche.' : 'Escribe tu nombre (al menos 2 letras).')
      } else {
        setHelpDone(true)
      }
    } catch {
      setError('No se pudo enviar. Revisa tu conexión e inténtalo otra vez, o escríbele a Cheche.')
    } finally {
      setHelpBusy(false)
    }
  }

  const switchMode = (next) => {
    setMode(next)
    setError(null)
    setHelpOpen(false)
  }

  const handleGoogle = async () => {
    if (googleBusy) return
    setError(null)
    setGoogleBusy(true)
    try {
      const { error: oauthError } = await signInWithGoogle()
      if (oauthError) throw oauthError
    } catch (err) {
      setError(friendlyAuthError(err, 'google'))
      setGoogleBusy(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setWaiting(null)
    setLoading(true)
    try {
      const { error: signInError } = await signIn(loginEmail(identifier), password, {
        // Muchos jugadores entrando a la vez: se reintenta solo, sin que tengas que hacer nada.
        onWait: (attempt, total) => setWaiting(`Hay mucha gente entrando a la vez… reintentando solo (${attempt}/${total})`),
      })
      if (signInError) throw signInError
      navigate('/', { replace: true })
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
      setWaiting(null)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const name = username.trim()
      const check = await rpc('check_signup_code', { p_code: normalizeCode(code), p_username: name })
      if (!check?.ok) {
        setError(REASONS[check?.reason] || 'No se pudo comprobar el código. Inténtalo otra vez.')
        return
      }
      const { data, error: signUpError } = await signUp(playerEmail(name), newPassword, { username: name, family_code: normalizeCode(code) })
      if (signUpError) throw signUpError
      if (!data?.session) {
        // Si el proyecto exigiera confirmar el correo, se intenta entrar de una vez.
        const { error: signInError } = await signIn(playerEmail(name), newPassword)
        if (signInError) throw signInError
      }
      navigate('/', { replace: true })
    } catch (err) {
      setError(friendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const copyLink = async () => {
    if (await copyText(window.location.origin)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  const closed = status && (status.open === false || status.full)

  return (
    <div className="min-h-screen bg-polygray-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-gradient-to-br from-polyblue to-blue-600 rounded-2xl p-8 mb-6 text-center shadow-xl">
          <div className="w-20 h-20 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <span className="text-4xl font-bold text-white">FM</span>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">FamilyMarket</h1>
          <p className="text-blue-100 text-sm">Mercado de predicciones familiar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 border border-gray-200">
          <div className="grid grid-cols-2 gap-1 bg-gray-100 rounded-xl p-1 mb-6" role="tablist" aria-label="Entrar o crear cuenta">
            {[
              ['login', 'Entrar'],
              ['signup', 'Soy nuevo'],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={mode === id}
                onClick={() => switchMode(id)}
                className={`py-2.5 rounded-lg font-bold text-sm transition ${mode === id ? 'bg-white text-polyblue shadow' : 'text-gray-500'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {googleOn && embedded && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900" role="status">
              <p className="font-bold mb-1">Ábrelo en tu navegador 🌐</p>
              <p>
                Estás dentro de otra app y Google no deja iniciar sesión aquí. Toca los tres puntos (⋯) y elige «Abrir en Safari» o «Abrir en Chrome», o copia el
                enlace y pégalo en tu navegador.
              </p>
              <button type="button" onClick={copyLink} className="mt-2 font-bold text-amber-800 underline">
                {copied ? '¡Enlace copiado!' : 'Copiar enlace'}
              </button>
            </div>
          )}

          {error && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3" role="alert">
              <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm flex-1">{error}</p>
            </div>
          )}

          {mode === 'login' ? (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-5 text-center">Iniciar sesión</h2>
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label htmlFor="identifier" className="block text-sm font-semibold text-gray-700 mb-2">
                    Usuario o correo
                  </label>
                  <input
                    id="identifier"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="tu nombre de jugador"
                    required
                    className={inputClass}
                  />
                </div>
                <PasswordField id="password" label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />

                {waiting && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3" role="status">
                    <Loader size={18} className="animate-spin text-amber-600 flex-shrink-0" />
                    <p className="text-amber-900 text-sm">{waiting}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader size={20} className="animate-spin" /> Entrando...
                    </>
                  ) : (
                    'Entrar'
                  )}
                </button>
              </form>
              {!helpOpen && (
                <button type="button" onClick={() => openHelp()} className="mt-4 w-full flex items-center justify-center gap-2 text-sm font-bold text-gray-600 py-2.5 rounded-xl bg-gray-50 border border-gray-200">
                  <LifeBuoy size={16} /> ¿Olvidaste tu usuario o tu contraseña?
                </button>
              )}
              {helpOpen && (
                <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4" aria-label="Pedir ayuda">
                  {helpDone ? (
                    <p className="text-sm text-amber-900">
                      <b>Listo.</b> Cheche vio tu solicitud y te escribirá con tu usuario y una contraseña nueva. <b>No crees otra cuenta</b>: perderías tu saldo y tus apuestas.
                    </p>
                  ) : (
                    <form onSubmit={sendHelp} className="space-y-3">
                      <p className="text-sm text-amber-900 font-semibold">No crees otra cuenta. Dinos quién eres y Cheche te devuelve el acceso.</p>
                      <div>
                        <label htmlFor="help-name" className="block text-xs font-bold text-amber-900 mb-1">
                          Tu nombre (el del juego o tu nombre real)
                        </label>
                        <input id="help-name" type="text" value={helpName} onChange={(e) => setHelpName(e.target.value)} maxLength={60} required className={inputClass} />
                      </div>
                      <div>
                        <label htmlFor="help-note" className="block text-xs font-bold text-amber-900 mb-1">
                          Algo que ayude a reconocerte (opcional)
                        </label>
                        <input id="help-note" type="text" value={helpNote} onChange={(e) => setHelpNote(e.target.value)} maxLength={200} placeholder="Ej: soy la hermana de Tomi" className={inputClass} />
                      </div>
                      <button type="submit" disabled={helpBusy || helpName.trim().length < 2} className="w-full bg-amber-500 text-white py-3 rounded-xl font-bold disabled:opacity-50">
                        {helpBusy ? 'Enviando…' : 'Pedir ayuda'}
                      </button>
                    </form>
                  )}
                </div>
              )}
              <button type="button" onClick={() => switchMode('signup')} className="mt-2 w-full min-h-[44px] text-polyblue font-bold">
                ¿Primera vez? Crea tu cuenta
              </button>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-1 text-center">Crea tu cuenta</h2>
              <p className="text-sm text-gray-500 text-center mb-5">Tardas un minuto. Empiezas con $1,000 para jugar.</p>

              {closed && (
                <div className="mb-5 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900" role="status">
                  {status.open === false ? REASONS.closed : REASONS.full}
                </div>
              )}

              <form onSubmit={handleSignup} className="space-y-5">
                <div>
                  <label htmlFor="code" className="block text-sm font-semibold text-gray-700 mb-2">
                    Código de la familia
                  </label>
                  <input
                    id="code"
                    type="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX"
                    required
                    className={`${inputClass} font-mono tracking-widest uppercase`}
                  />
                  <p className="text-xs text-gray-500 mt-1.5">Está en el mensaje que mandó Cheche al grupo.</p>
                </div>

                <div>
                  <label htmlFor="username" className="block text-sm font-semibold text-gray-700 mb-2">
                    Tu nombre de jugador
                  </label>
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ej: Mari_23"
                    required
                    className={inputClass}
                  />
                  {similar.length > 0 && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900" role="alert">
                      Ya hay un jugador parecido: <b>{similar.join(', ')}</b>. Si eres tú, <b>no crees otra cuenta</b>.{' '}
                      <button type="button" onClick={() => openHelp(similar[0])} className="font-bold underline">
                        Pedir ayuda
                      </button>
                    </div>
                  )}
                  <p className={`text-xs mt-1.5 flex items-center gap-1 ${nameHint === 'taken' || nameHint === 'invalid' ? 'text-red-600' : nameHint === 'ok' ? 'text-green-700' : 'text-gray-500'}`}>
                    {nameHint === 'ok' && <CheckCircle2 size={13} />}
                    {nameHint === 'ok'
                      ? 'Disponible'
                      : nameHint === 'taken'
                        ? 'Ese nombre ya está en uso'
                        : nameHint === 'invalid'
                          ? 'De 3 a 20 letras, números o guion bajo (_)'
                          : 'Así te verán los demás. De 3 a 20 letras, números o _'}
                  </p>
                </div>

                <PasswordField id="new-password" label="Crea una contraseña" value={newPassword} onChange={setNewPassword} autoComplete="new-password" hint="Mínimo 6 caracteres. Anótala: no hay correo para recuperarla, Cheche te la restablece si la olvidas." />

                <button
                  type="submit"
                  disabled={loading || closed || nameHint === 'taken'}
                  className="w-full bg-polyblue text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader size={20} className="animate-spin" /> Creando tu cuenta...
                    </>
                  ) : (
                    'Crear mi cuenta y entrar'
                  )}
                </button>
              </form>
              <button type="button" onClick={() => switchMode('login')} className="mt-3 w-full min-h-[44px] text-polyblue font-bold">
                ¿Ya tienes cuenta? Entra aquí
              </button>
              <button type="button" onClick={() => openHelp()} className="mt-1 w-full min-h-[44px] text-sm font-semibold text-gray-500">
                ¿Ya jugabas y olvidaste tu usuario? Pide ayuda
              </button>
            </>
          )}

          {googleOn && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-gray-400 font-semibold uppercase tracking-wider">
                <span className="flex-1 h-px bg-gray-200" />o<span className="flex-1 h-px bg-gray-200" />
              </div>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleBusy}
                className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-300 text-gray-800 py-3 rounded-xl font-bold hover:bg-gray-50 active:scale-[0.99] transition disabled:opacity-60 shadow-sm"
              >
                {googleBusy ? <Loader size={20} className="animate-spin" /> : <GoogleLogo />}
                Continuar con Google
              </button>
            </>
          )}
        </div>

        <div className="text-center mt-6 text-sm text-gray-500">
          <p>Evento familiar de predicciones</p>
        </div>
      </div>
    </div>
  )
}
