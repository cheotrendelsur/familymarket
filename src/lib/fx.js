// Efectos de celebración: confeti, vibración y sonidos opcionales.
// Todo se carga bajo demanda y respeta "reducir movimiento" del sistema.
import { store } from './storage'

export const prefersReducedMotion = () => {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- vibración
export const hapticsEnabled = () => store.get('fm_haptics', true)
export const setHapticsEnabled = (v) => store.set('fm_haptics', !!v)

export function haptic(pattern = 12) {
  if (!hapticsEnabled()) return
  try {
    // Chrome ignora (y avisa en consola) la vibración antes del primer toque; así no hay ruido
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return
    navigator.vibrate?.(pattern)
  } catch {
    /* no soportado (iOS Safari) */
  }
}

export const HAPTIC = {
  tap: 8,
  success: [14, 40, 22],
  reject: [40, 60, 40],
  win: [30, 50, 30, 50, 30, 50, 120],
  lose: [60, 40, 30],
  close: [20, 30, 20],
}

// ------------------------------------------------------------------ sonidos
export const soundEnabled = () => store.get('fm_sound', false)
export const setSoundEnabled = (v) => store.set('fm_sound', !!v)

let audioCtx = null
function ctx() {
  if (audioCtx) return audioCtx
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  audioCtx = new Ctor()
  return audioCtx
}

function tone(c, freq, start, dur, { type = 'sine', gain = 0.07 } = {}) {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = c.currentTime + start
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

const SOUNDS = {
  win: (c) => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(c, f, i * 0.09, 0.35, { type: 'triangle' })),
  success: (c) => [660, 880].forEach((f, i) => tone(c, f, i * 0.08, 0.2, { type: 'triangle' })),
  reject: (c) => [220, 165].forEach((f, i) => tone(c, f, i * 0.11, 0.22, { type: 'sawtooth', gain: 0.04 })),
  lose: (c) => [392, 330, 262].forEach((f, i) => tone(c, f, i * 0.16, 0.35, { type: 'sine', gain: 0.05 })),
  close: (c) => [523.25, 392].forEach((f, i) => tone(c, f, i * 0.12, 0.3, { type: 'sine', gain: 0.05 })),
}

export function playSound(name) {
  if (!soundEnabled()) return
  try {
    const c = ctx()
    if (!c) return
    if (c.state === 'suspended') c.resume()
    SOUNDS[name]?.(c)
  } catch {
    /* sin audio */
  }
}

// ------------------------------------------------------------------- confeti
let confettiPromise = null
const loadConfetti = () => {
  confettiPromise ||= import('canvas-confetti').then((m) => m.default)
  return confettiPromise
}

const WIN_COLORS = ['#009E60', '#34D399', '#FBBF24', '#F59E0B', '#2563EB', '#F472B6', '#FFFFFF']

/** Lluvia de confeti larga para una victoria. Devuelve una función para detenerla. */
export async function fireWinConfetti() {
  if (prefersReducedMotion()) return () => {}
  let stopped = false
  const confetti = await loadConfetti()
  const end = Date.now() + 2600
  const common = { colors: WIN_COLORS, zIndex: 200, disableForReducedMotion: true }

  confetti({ ...common, particleCount: 110, spread: 85, startVelocity: 52, origin: { x: 0.5, y: 0.6 }, ticks: 240 })
  setTimeout(() => !stopped && confetti({ ...common, particleCount: 60, spread: 120, startVelocity: 36, origin: { x: 0.5, y: 0.5 }, scalar: 1.2 }), 380)

  const coin = confetti.shapeFromText({ text: '💸', scalar: 2 })
  const star = confetti.shapeFromText({ text: '⭐', scalar: 2 })
  const frame = () => {
    if (stopped) return
    confetti({ ...common, particleCount: 3, angle: 60, spread: 60, startVelocity: 58, origin: { x: 0, y: 0.78 } })
    confetti({ ...common, particleCount: 3, angle: 120, spread: 60, startVelocity: 58, origin: { x: 1, y: 0.78 } })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
  setTimeout(
    () =>
      !stopped &&
      confetti({
        ...common,
        particleCount: 18,
        spread: 160,
        startVelocity: 22,
        gravity: 0.7,
        origin: { x: 0.5, y: 0 },
        shapes: [coin, star],
        scalar: 2,
        flat: true,
        ticks: 320,
      }),
    700
  )

  return () => {
    stopped = true
    confetti.reset()
  }
}

/** Ráfaga corta desde un punto de pantalla (compra exitosa). */
export async function fireBurst(point, side = 'YES') {
  if (prefersReducedMotion()) return
  const confetti = await loadConfetti()
  const colors = side === 'YES' ? ['#009E60', '#34D399', '#A7F3D0', '#FBBF24'] : ['#E02D3C', '#F87171', '#FECACA', '#FBBF24']
  const origin = {
    x: Math.min(Math.max(point.x / window.innerWidth, 0), 1),
    y: Math.min(Math.max(point.y / window.innerHeight, 0), 1),
  }
  confetti({
    colors,
    origin,
    zIndex: 200,
    particleCount: 38,
    spread: 70,
    startVelocity: 34,
    scalar: 0.8,
    ticks: 120,
    gravity: 1.1,
    disableForReducedMotion: true,
  })
}

/** Confeti suave (sugerencia aprobada, etc.). */
export async function fireSoftConfetti() {
  if (prefersReducedMotion()) return
  const confetti = await loadConfetti()
  confetti({
    colors: WIN_COLORS,
    zIndex: 200,
    particleCount: 70,
    spread: 90,
    startVelocity: 40,
    origin: { x: 0.5, y: 0.65 },
    ticks: 180,
    disableForReducedMotion: true,
  })
}
