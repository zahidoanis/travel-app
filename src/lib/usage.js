/**
 * Anonymous usage counts for the admin page (/admin) — how many browsers
 * opened the app today, how many trips were made, how much AI was used.
 *
 * Nothing personal leaves the browser: no name, no email, no IP is stored.
 * A "visitor" is a random id this browser makes up once and keeps, so the
 * same person on a phone and a laptop counts as two.
 */

const PROXY = (import.meta.env?.VITE_AI_PROXY_URL ?? '').replace(/\/$/, '')
const KEY = 'tripai.cid'

let cached = null

/** This browser's random id — made once, then reused. */
export function clientId() {
  if (cached) return cached
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem(KEY, id)
    }
    cached = id
  } catch {
    cached = '' // storage blocked — counted without a visitor id
  }
  return cached
}

/**
 * Reports one event: 'open' (the app was opened), 'trip' (a trip was
 * created), 'import' (one came in from Google Maps), 'join' (someone joined
 * a shared trip). Fire-and-forget — never awaited, never shown, and a
 * failure costs nothing.
 */
export function hit(ev) {
  if (!PROXY) return
  try {
    fetch(`${PROXY}/hit?ev=${encodeURIComponent(ev)}&cid=${encodeURIComponent(clientId())}`, {
      mode: 'no-cors',
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* counting is never worth an error */
  }
}

/** 'open', once per browser session — not once per tab switch or reload storm. */
export function hitOpenOnce() {
  try {
    if (sessionStorage.getItem('tripai.opened')) return
    sessionStorage.setItem('tripai.opened', '1')
  } catch {
    /* no sessionStorage: count it anyway */
  }
  hit('open')
}
