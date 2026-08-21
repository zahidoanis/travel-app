/**
 * Geocoding via Nominatim (OpenStreetMap) — free, no API key.
 *
 * Why not let the model supply coordinates: an LLM will confidently produce
 * plausible-looking lat/lng that are off by streets or kilometres, and a map
 * pin in the wrong place is worse than no pin. Nominatim returns the real
 * position or nothing, which is a failure mode we can handle.
 *
 * Usage policy: max 1 request per second, and a identifying User-Agent or
 * Referer. Browsers set Referer automatically and refuse to let us set
 * User-Agent, so the rate limit is the part we have to honour ourselves.
 */

import { record } from './telemetry'

// Through our own worker when one is configured: Nominatim rejects any request
// without an identifying User-Agent, and a browser cannot set that header.
const PROXY = import.meta.env?.VITE_AI_PROXY_URL ?? ''
const ENDPOINT = PROXY
  ? `${PROXY.replace(/\/$/, '')}/geocode`
  : 'https://nominatim.openstreetmap.org/search'

const MIN_GAP_MS = 1100

const cache = new Map()
let lastCall = 0

/** Serialises calls so we never exceed one per second. */
async function throttle() {
  const wait = lastCall + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
}

/**
 * Resolves one place to { lat, lng, label }, or null when nothing matches.
 * `context` narrows the search — a city name, usually.
 */
export async function geocode(query, context = '') {
  const key = `${query}|${context}`.toLowerCase()
  if (cache.has(key)) return cache.get(key)

  await throttle()

  const q = context ? `${query}, ${context}` : query
  const url = PROXY
    ? `${ENDPOINT}?${new URLSearchParams({ q })}`
    : `${ENDPOINT}?${new URLSearchParams({ q, format: 'json', limit: '1' })}`

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    // The proxy returns the normalised shape (or null); Nominatim returns an array.
    const hit = PROXY ? data : data[0]
    const result = hit
      ? { lat: Number(hit.lat), lng: Number(hit.lng ?? hit.lon), label: hit.label ?? hit.display_name }
      : null

    cache.set(key, result)
    return result
  } catch (err) {
    record({
      kind: 'network',
      level: 'warn',
      message: `גיאוקודינג נכשל עבור "${query}"`,
      context: { query, context, error: err?.message },
    })
    cache.set(key, null)
    return null
  }
}

/**
 * Geocodes a list in order, respecting the rate limit. Entries that cannot be
 * resolved keep `lat`/`lng` null so the caller can decide — we drop them from
 * the map rather than guessing.
 */
export async function geocodeAll(places, context) {
  const out = []
  for (const place of places) {
    const hit = await geocode(place.query, context)
    out.push({ ...place, lat: hit?.lat ?? null, lng: hit?.lng ?? null })
  }
  return out
}
