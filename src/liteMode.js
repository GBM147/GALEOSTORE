import { useSyncExternalStore } from 'react'

// Weak phones and slow or metered connections get the same store without
// smooth scrolling, decorative motion, autoplay video and blur effects.
// Visitors can switch it on or off in the footer; the choice is remembered.
export const LITE_STORAGE_KEY = 'galeo-lite'
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g', '3g'])
const listeners = new Set()
let state = { lite: false, reason: '' }

function storage() {
  try { return globalThis.localStorage || null } catch { return null }
}

export function detectLiteMode({ navigator: nav = globalThis.navigator, matchMedia = globalThis.matchMedia?.bind(globalThis), search = globalThis.location?.search || '', store = storage() } = {}) {
  const requested = new URLSearchParams(search).get('lite')
  if (requested === '1' || requested === '0') {
    try { store?.setItem(LITE_STORAGE_KEY, requested) } catch {}
    return { lite: requested === '1', reason: 'manual' }
  }
  let saved = null
  try { saved = store?.getItem(LITE_STORAGE_KEY) } catch {}
  if (saved === '1' || saved === '0') return { lite: saved === '1', reason: 'manual' }
  const connection = nav?.connection
  if (connection?.saveData === true) return { lite: true, reason: 'save-data' }
  if (SLOW_CONNECTIONS.has(connection?.effectiveType)) return { lite: true, reason: 'slow-connection' }
  const memory = Number(nav?.deviceMemory)
  // Chromium reports up to 3 GB of RAM as 2. CPU core counts are not used:
  // small CI and cloud machines report 2 cores and would always look weak.
  if (memory > 0 && memory <= 2) return { lite: true, reason: 'low-memory' }
  try { if (matchMedia?.('(prefers-reduced-data: reduce)').matches) return { lite: true, reason: 'save-data' } } catch {}
  return { lite: false, reason: '' }
}

function apply() {
  const root = globalThis.document?.documentElement
  if (!root) return
  if (state.lite) root.dataset.lite = 'true'
  else delete root.dataset.lite
}

export function initLiteMode(environment) {
  state = detectLiteMode(environment)
  apply()
  return state
}

export function setLiteMode(lite) {
  state = { lite: Boolean(lite), reason: 'manual' }
  try { storage()?.setItem(LITE_STORAGE_KEY, state.lite ? '1' : '0') } catch {}
  apply()
  listeners.forEach(listener => listener())
}

export const liteModeActive = () => state.lite

const subscribe = listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLiteMode() {
  return useSyncExternalStore(subscribe, liteModeActive, () => false)
}
