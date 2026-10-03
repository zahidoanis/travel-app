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

/** Kilometres between two points (haversine). */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

/** Within a day trip of the destination. Anything further is another place
 *  with the same name. */
const NEAR_KM = 120
const near = (hit, origin) =>
  origin?.lat == null || origin?.lng == null || distanceKm(hit, origin) <= NEAR_KM

/** The destination's name in Latin letters when there is one. Hebrew names
 *  geocode badly — "פראג" once matched a bus stop in Or Akiva — and the
 *  English one is stored alongside it for exactly this. */
const cityOf = (trip) => trip?.cityEn || trip?.destinationEn || trip?.city || trip?.destination || ''

/**
 * Candidates for a place on this trip: searched with the destination's
 * English name, and only those near the destination kept.
 *
 * Several screens used to search "<name>, <Hebrew city>" or the bare name
 * and take the first answer, so a restaurant, hotel or suggestion could land
 * on a namesake in another city or country — that is how a stop ended up in
 * the wrong place on the map. `trip` is anything with lat/lng and
 * cityEn/city (or onboarding's destinationEn/destination).
 */
export async function searchNear(query, trip, limit = 5, details = false) {
  const city = cityOf(trip)
  const scoped = city && !query.toLowerCase().includes(city.toLowerCase()) ? `${query}, ${city}` : query
  let hits = (await search(scoped, limit, undefined, details)).filter((h) => near(h, trip))
  if (hits.length === 0 && scoped !== query) {
    hits = (await search(query, limit, undefined, details)).filter((h) => near(h, trip))
  }
  return hits
}

/** The best single match near the trip, or null. */
export async function geocodeNear(query, trip) {
  const [hit] = await searchNear(query, trip, 3)
  return hit ?? null
}

/**
 * Geocodes a list in order. Entries that cannot be resolved keep null
 * coordinates so the caller can decide — we drop them rather than guessing.
 *
 * With an `origin` (anything with lat/lng), only a match within a day trip
 * of it counts. A generated day used to take the first match wherever it
 * was, so a café named like one in Paris put a pin in Texas, and the day's
 * route ran across an ocean.
 */
export async function geocodeAll(places, context, origin = null) {
  const out = []
  for (const place of places) {
    const query = context ? `${place.query}, ${context}` : place.query
    const hits = await search(query, origin ? 3 : 1)
    const hit = hits.find((h) => near(h, origin)) ?? null
    out.push({ ...place, lat: hit?.lat ?? null, lng: hit?.lng ?? null })
  }
  return out
}
