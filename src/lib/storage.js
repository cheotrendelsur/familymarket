// localStorage seguro: en modo privado / sin permisos puede lanzar errores.
// Solo para comodidades por dispositivo (nunca para datos del juego).

export const store = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? fallback : JSON.parse(raw)
    } catch {
      return fallback
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* sin almacenamiento: la app sigue funcionando */
    }
  },
}
