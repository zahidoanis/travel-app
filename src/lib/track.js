/**
 * The route actually walked: GPS fixes recorded while a trip is on, kept on
 * this device only.
 *
 * Local on purpose. A location history across days is some of the most
 * sensitive data an app can hold; nothing here is sent anywhere, so there is
 * nothing to leak, nothing to consent to on behalf of others, and it keeps
 * working with no signal abroad. The cost is that it lives on the phone that
 * recorded it.
 *
 * A point is [lat, lng, unixSeconds].
 */

const KEY = (tripId) => `tripai.track.${tripId}`
/** Fixes closer than this to the last one are standing still, not moving. */
const MIN_MOVE_M = 25
/** A fix with worse accuracy than this (metres) is a guess, not a position. */
const MAX_ACCURACY_M = 80
/** Beyond this the oldest detail is thinned out (every second point). */
const MAX_POINTS = 6000
/** A pause this long (seconds) ends one stretch of the line and starts another. */
export const GAP_S = 20 * 60

export function loadTrack(tripId) {
  if (!tripId) return []
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(tripId)) ?? '[]')
    return Array.isArray(raw) ? raw.filter((p) => Array.isArray(p) && p.length >= 3) : []
  } catch {
    return []
  }
}

export function saveTrack(tripId, points) {
  try {
    localStorage.setItem(KEY(tripId), JSON.stringify(points))
  } catch {
    /* storage full or blocked — the live line still draws this session */
  }
}

export function clearTrack(tripId) {
  try {
    localStorage.removeItem(KEY(tripId))
  } catch {
    /* nothing to clear */
  }
}

/** Metres between two [lat, lng] pairs. */
export function metres(a, b) {
  const rad = Math.PI / 180
  const x = (b[1] - a[1]) * rad * Math.cos(((a[0] + b[0]) / 2) * rad)
  const y = (b[0] - a[0]) * rad
  return Math.sqrt(x * x + y * y) * 6371000
}

/**
 * The track with one more fix, or the same array when the fix adds nothing
 * (inaccurate, or hardly moved since the last point).
 */
export function appendFix(points, { lat, lng, accuracy }, now = Date.now()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return points
  if (accuracy != null && accuracy > MAX_ACCURACY_M) return points

  const p = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, Math.round(now / 1000)]
  const last = points.at(-1)
  if (last && metres(last, p) < MIN_MOVE_M) return points

  const next = [...points, p]
  if (next.length <= MAX_POINTS) return next
  // Thin the older half, keep the recent half as it is.
  const cut = Math.floor(next.length / 2)
  return [...next.slice(0, cut).filter((_, i) => i % 2 === 0), ...next.slice(cut)]
}

/** The track split into stretches wherever there was a long pause. */
export function segments(points) {
  const out = []
  let cur = []
  for (const p of points) {
    const prev = cur.at(-1)
    if (prev && p[2] - prev[2] > GAP_S) {
      if (cur.length > 0) out.push(cur)
      cur = []
    }
    cur.push(p)
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/** Kilometres walked, summing only within a stretch (a pause isn't distance). */
export function trackKm(points) {
  let m = 0
  for (const seg of segments(points)) for (let i = 1; i < seg.length; i++) m += metres(seg[i - 1], seg[i])
  return m / 1000
}
