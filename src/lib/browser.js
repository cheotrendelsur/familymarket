// Utilidades del navegador para el inicio de sesión.

/**
 * ¿La página está abierta dentro de otra app (Instagram, Facebook, TikTok, Line…)?
 * Esos visores internos son WebViews y Google NO deja iniciar sesión en ellos (error 403 disallowed_useragent).
 * La app instalada en la pantalla de inicio de iPhone tampoco tiene «Safari/» en su identificador, pero ahí sí funciona.
 */
export function inAppBrowser(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  if (/FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|MicroMessenger|Line\/|Twitter|LinkedInApp|; wv\)/i.test(ua)) return true
  const ios = /iPhone|iPad|iPod/i.test(ua)
  const standalone =
    typeof window !== 'undefined' &&
    (window.navigator?.standalone === true || window.matchMedia?.('(display-mode: standalone)')?.matches === true)
  return ios && !standalone && !/Safari\//i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}
