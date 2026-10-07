import { metres } from './track'

/**
 * How long it takes to get from one stop to the next — an estimate from the
 * straight line between them, not a routed answer.
 *
 * A real router would be better, but every free one limits use (OSRM's public
 * server is "light use only"), and the plan needs a feel for a day — "20
 * minutes on foot" or "a ride" — not turn-by-turn. So: the street distance is
 * taken as 1.3x the straight line (typical for a city grid), a walk is 4.8
 * km/h, and anything over 2 km is a ride at ~22 km/h plus 5 minutes to
 * get going. The screens say "~" and "estimate" wherever these are shown.
 */
const DETOUR = 1.3
const WALK_KMH = 4.8
const RIDE_KMH = 22
const RIDE_OVERHEAD_MIN = 5
const WALK_MAX_KM = 2

/** @returns {{ km: number, minutes: number, mode: 'walk' | 'ride' } | null} */
export function leg(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null
  const km = (metres([a.lat, a.lng], [b.lat, b.lng]) / 1000) * DETOUR
  if (km < 0.05) return { km, minutes: 1, mode: 'walk' }
  if (km <= WALK_MAX_KM) return { km, minutes: Math.max(1, Math.round((km / WALK_KMH) * 60)), mode: 'walk' }
  return { km, minutes: Math.round((km / RIDE_KMH) * 60 + RIDE_OVERHEAD_MIN), mode: 'ride' }
}

/** Legs between consecutive located stops of one day. */
export function dayLegs(stops) {
  return stops.slice(0, -1).map((s, i) => leg(s, stops[i + 1]))
}

/** Total estimated distance of a day, in km. */
export function dayKm(stops) {
  return dayLegs(stops).reduce((sum, l) => sum + (l?.km ?? 0), 0)
}

/** "12" or "1:05" — minutes as a short duration. */
export function fmtMinutes(min) {
  if (min < 60) return `${min}`
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}
