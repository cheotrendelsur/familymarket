// Polyfills para jsdom + captura de errores de React (keys repetidas, hooks mal usados, etc.)
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

globalThis.ResizeObserver =
  globalThis.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
window.matchMedia =
  window.matchMedia ||
  ((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }))
window.scrollTo = vi.fn()
window.confirm = vi.fn(() => true)
window.alert = vi.fn()

export const consoleErrors = []
const original = console.error
console.error = (...args) => {
  consoleErrors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '))
  original(...args)
}

afterEach(() => {
  cleanup()
})
