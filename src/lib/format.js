// Formateadores compartidos (es-VE). Todos toleran null/undefined/NaN.

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

export const money = (v, dp = 2) =>
  `$${num(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`

export const signedMoney = (v, dp = 2) => {
  const n = num(v)
  return `${n >= 0 ? '+' : '-'}${money(Math.abs(n), dp)}`
}

/** 0.4567 -> "45.7¢" */
export const cents = (p, dp = 1) => `${(num(p) * 100).toFixed(dp)}¢`

/** 0.4567 -> "46%" */
export const pct = (p, dp = 0) => `${(num(p) * 100).toFixed(dp)}%`

export const percentValue = (v, dp = 1) => `${num(v) >= 0 ? '+' : ''}${num(v).toFixed(dp)}%`

export const shares = (v, dp = 2) =>
  num(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const dateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('es-VE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

export const dateShort = (iso) =>
  iso ? new Date(iso).toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

export const timeShort = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : ''

/** Lado de una apuesta tal como se muestra al jugador (en la base de datos sigue siendo YES/NO). */
export const sideLabel = (side) => (side === 'YES' ? 'Sí' : 'No')

/** 1250 -> "$1.2k" (para etiquetas pequeñas). */
export const compactMoney = (v) => {
  const n = num(v)
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${n < 0 ? '-' : ''}$${(abs / 1000).toFixed(0)}k`
  if (abs >= 1000) return `${n < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`
  return `${n < 0 ? '-' : ''}$${abs.toFixed(0)}`
}

/** "Mari" -> "M" (iniciales para avatares). */
export const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase()

const AVATAR_COLORS = ['#2563EB', '#009E60', '#E02D3C', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#475569']
/** Color estable por nombre (mismo jugador, mismo color en todas las pantallas). */
export const avatarColor = (name) => {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/** Traduce errores de inicio de sesión / registro. */
export function friendlyAuthError(error, context = 'password') {
  const msg = (error && (error.message || String(error))) || ''
  if (/Invalid login credentials/i.test(msg)) return 'Usuario o contraseña incorrectos. Si lo olvidaste, pídele a Cheche que te la restablezca.'
  // La base de datos solo deja crear cuentas con el código de la familia o con un correo invitado (migraciones 015 y 018).
  if (/banned|user_banned/i.test(msg)) return 'Esta cuenta está deshabilitada. Pídele ayuda a Cheche.'
  if (/should be different from the old password|same_password/i.test(msg)) return 'Elige una contraseña distinta a la temporal.'
  if (/BAD_CODE/i.test(msg)) return 'Ese código no es correcto. Revisa el mensaje del grupo de la familia.'
  if (/SIGNUP_CLOSED/i.test(msg)) return 'El registro está cerrado por ahora. Pídele a Cheche que lo abra.'
  if (/SIGNUP_FULL/i.test(msg)) return 'Ya se completó el cupo de jugadores.'
  if (/USERNAME_TAKEN/i.test(msg)) return 'Ese nombre ya está en uso. Elige otro.'
  if (/USERNAME_INVALID|BAD_EMAIL/i.test(msg)) return 'Tu nombre debe tener de 3 a 20 letras, números o guion bajo (_).'
  if (/Database error saving new user|EMAIL_NOT_INVITED|signups? not allowed/i.test(msg)) {
    return context === 'google'
      ? 'Ese correo de Google no está en la lista de la familia. Pídele a Cheche que lo agregue, o crea tu cuenta con el código de la familia.'
      : 'No se pudo crear la cuenta. Revisa que el código sea correcto y que el nombre no esté ya en uso.'
  }
  if (/PASSWORD_NOT_ALLOWED/i.test(msg)) return 'Ese correo debe entrar con Google. Toca «Continuar con Google».'
  if (/EMAIL_DUPLICATE/i.test(msg)) return 'Ya hay una cuenta con ese correo. Entra con Google o con tu contraseña.'
  if (/access_denied|cancel/i.test(msg)) return 'Cancelaste el inicio de sesión con Google. Puedes intentarlo otra vez.'
  if (/User already registered|already been registered/i.test(msg)) return 'Ese correo ya tiene una cuenta. Inicia sesión.'
  if (/Email not confirmed/i.test(msg)) return 'Debes confirmar tu correo antes de entrar. Revisa tu bandeja de entrada.'
  if (/rate limit|too many|over_request_rate_limit|over_email_send_rate_limit/i.test(msg)) {
    return 'Hay mucha gente entrando a la vez. Espera unos segundos y vuelve a intentarlo (tu contraseña no tiene problema).'
  }
  if (/Password should be at least/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.'
  if (/Unable to validate email|invalid format/i.test(msg)) return 'Escribe un correo válido.'
  return friendlyError(error)
}

/** Traduce errores técnicos de Supabase/red a mensajes claros para el usuario. */
export function friendlyError(error) {
  const msg = (error && (error.message || String(error))) || 'Ocurrió un error inesperado'
  if (/Failed to fetch|NetworkError|Load failed|network request failed/i.test(msg)) {
    return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'
  }
  if (/lock timeout|canceling statement/i.test(msg)) {
    return 'El mercado está muy concurrido en este momento. Inténtalo de nuevo en unos segundos.'
  }
  if (/JWT|not authenticated|no autenticado/i.test(msg)) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.'
  }
  if (/Timeout acquiring connection|PGRST003|503/i.test(msg)) {
    return 'El servidor está saturado. Espera unos segundos y reintenta.'
  }
  return msg
}
