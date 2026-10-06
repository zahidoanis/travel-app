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

// Nominatim allows one request a second — that limit is on whoever calls
// Nominatim. Through the worker the first lookup goes to Photon, which has
// no such limit (and the worker spaces its own Nominatim fallback), so the
// browser can ask faster: 30 stops of a multi-day plan took 33s at 1.1s each.
const MIN_GAP_MS = PROXY ? 350 : 1100

const cache = new Map()
let queue = Promise.resolve()
let lastCall = 0

/**
 * Paces every lookup so concurrent callers cannot exceed the rate limit.
 * Direct to Nominatim each lookup also waits for the one before it to finish.
 * Through the worker only the *start* is paced, so answers can overlap: 30
 * stops no longer cost 30 round trips in a row.
 */
function enqueue(fn) {
  const started = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    return PROXY ? undefined : fn()
  })
  // Keep the chain alive even if one lookup rejects.
  if (PROXY) {
    queue = started.catch(() => {})
    return started.then(fn)
  }
  queue = started.catch(() => {})
  return started
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
  // Only present on a details lookup.
  phone: h.phone ?? h.extratags?.phone ?? null,
  website: h.website ?? h.extratags?.website ?? null,
  hours: h.hours ?? h.extratags?.opening_hours ?? null,
})

/**
 * Candidates for one query — what autocomplete needs.
 * `kind: 'city'` restricts results to settlements rather than shops that
 * happen to share the name.
 */
export function search(query, limit = 5, kind, details = false) {
  const q = query.trim()
  if (q.length < 2) return Promise.resolve([])

  const key = `${q}|${limit}|${kind ?? ''}|${details ? 'd' : ''}`.toLowerCase()
  if (cache.has(key)) return Promise.resolve(cache.get(key))

  return enqueue(async () => {
    // `details` asks for contact information — phone, website, hours — which
    // only Nominatim carries, so the proxy routes that query differently.
    const params = PROXY
      ? {
          q,
          limit: String(limit),
          ...(kind ? { kind } : {}),
          ...(details ? { details: '1' } : {}),
        }
      : { q, format: 'json', limit: String(limit), addressdetails: '1', extratags: details ? '1' : '0' }

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
        message: `חיפוש מיקום נכשל עבור "${q}"`, // i18n-ignore — internal log
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
  // All asked at once — enqueue() spaces their starts, and through the
  // worker the answers overlap. Order of the results is the input's order.
  const hits = await Promise.all(places.map((place) => geocode(place.query, context)))
  return places.map((place, i) => ({ ...place, lat: hits[i]?.lat ?? null, lng: hits[i]?.lng ?? null }))
}
