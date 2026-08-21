/**
 * Geocoding via Nominatim (OpenStreetMap) — free, no API key.
 *
 * Why not let the model supply coordinates: an LLM will confidently produce
 * plausible-looking lat/lng that are off by streets or kilometres, and a map
 * pin in the wrong place is worse than no pin. Nominatim returns the real
 * position or nothing, which is a failure mode we can handle.
 *
 * Requests go through our own worker when one is configured, because
 * Nominatim answers 403 to anything without an identifying User-Agent and a
 * browser cannot set that header.
 */

import { record } from './telemetry'

const PROXY = import.meta.env?.VITE_AI_PROXY_URL ?? ''
const ENDPOINT = PROXY
  ? `${PROXY.replace(/\/$/, '')}/geocode`
  : 'https://nominatim.openstreetmap.org/search'

const MIN_GAP_MS = 1100 // Nominatim allows at most one request per second

const cache = new Map()
let queue = Promise.resolve()
let lastCall = 0

/** Serialises every lookup so concurrent callers cannot exceed the rate limit. */
function enqueue(fn) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    return fn()
  })
  // Keep the chain alive even if one lookup rejects.
  queue = run.catch(() => {})
  return run
}

/** Normalised shape, whichever backend answered. */
const normalise = (h) => ({
  lat: Number(h.lat),
  lng: Number(h.lng ?? h.lon),
  label: h.label ?? h.display_name,
  name: h.name || (h.label ?? h.display_name ?? '').split(',')[0],
  city: h.city ?? h.address?.city ?? h.address?.town ?? h.address?.village ?? '',
  country: h.country ?? h.address?.country ?? '',
  type: h.type ?? h.addresstype ?? '',
})

/**
 * Candidates for one query — what autocomplete needs.
 * `kind: 'city'` restricts results to settlements rather than shops that
 * happen to share the name.
 */
export function search(query, limit = 5, kind) {
  const q = query.trim()
  if (q.length < 2) return Promise.resolve([])

  const key = `${q}|${limit}|${kind ?? ''}`.toLowerCase()
  if (cache.has(key)) return Promise.resolve(cache.get(key))

  return enqueue(async () => {
    const params = PROXY
      ? { q, limit: String(limit), ...(kind ? { kind } : {}) }
      : { q, format: 'json', limit: String(limit), addressdetails: '1' }

    try {
      const res = await fetch(`${ENDPOINT}?${new URLSearchParams(params)}`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const hits = (await res.json()).map(normalise)
      // Only remember hits. An empty result is more often a throttled request
      // than a place that does not exist, and caching it makes the miss stick.
      if (hits.length > 0) cache.set(key, hits)
      return hits
    } catch (err) {
      record({
        kind: 'network',
        level: 'warn',
        message: `חיפוש מיקום נכשל עבור "${q}"`,
        context: { query: q, error: err?.message },
      })
      return []
    }
  })
}

/** Resolves one place, or null when nothing matches. */
export async function geocode(query, context = '') {
  const [hit] = await search(context ? `${query}, ${context}` : query, 1)
  return hit ?? null
}

/**
 * Geocodes a list in order. Entries that cannot be resolved keep null
 * coordinates so the caller can decide — we drop them rather than guessing.
 */
export async function geocodeAll(places, context) {
  const out = []
  for (const place of places) {
    const hit = await geocode(place.query, context)
    out.push({ ...place, lat: hit?.lat ?? null, lng: hit?.lng ?? null })
  }
  return out
}
