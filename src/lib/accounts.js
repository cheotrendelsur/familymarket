// Cuentas de jugador: nombre de usuario + contraseña (sin correos).
// Por dentro cada jugador tiene un correo interno inventado (nombre@jugador.familymarket.invalid): no recibe mensajes,
// solo sirve para que el sistema de cuentas funcione. Quien se registró antes con un correo real sigue entrando con él.

export const PLAYER_EMAIL_DOMAIN = 'jugador.familymarket.invalid'
export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/

export const playerEmail = (username) => `${String(username).trim().toLowerCase()}@${PLAYER_EMAIL_DOMAIN}`

/** Lo que escribe la persona en «Usuario o correo» -> correo con el que se inicia sesión. */
export const loginEmail = (identifier) => {
  const v = String(identifier || '').trim()
  return v.includes('@') ? v.toLowerCase() : playerEmail(v)
}

/** Código de la familia: se ignoran guiones, espacios y mayúsculas/minúsculas. */
export const normalizeCode = (code) => String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()

/** K7QX3P9D -> K7QX-3P9D (así se muestra y se lee mejor). */
export const formatCode = (code) => {
  const c = normalizeCode(code)
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c
}
