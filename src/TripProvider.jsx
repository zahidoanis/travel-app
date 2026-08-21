import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { PARTY_COLORS } from './data'
import { buildItinerary } from './lib/itinerary'
import { loadProfile, saveProfile, saveRoute, listRoutes } from './lib/db'
import { breadcrumb, record } from './lib/telemetry'

/**
 * Single source of truth for the current trip.
 *
 * There is deliberately no sample trip behind this. Every screen shows what
 * the user actually entered or what the agent actually produced, and an empty
 * state where there is nothing yet — a placeholder Paris itinerary is
 * indistinguishable from a real one that failed to load.
 */
const TripContext = createContext(null)

export const useTrip = () => {
  const ctx = useContext(TripContext)
  if (!ctx) throw new Error('useTrip must be used inside <TripProvider>')
  return ctx
}

/** Onboarding answers -> the shape the rest of the app expects. */
function toTrip(profile) {
  if (!profile?.destination) return null

  const from = profile.from ? new Date(profile.from) : null
  const to = profile.to ? new Date(profile.to) : null
  const totalDays = from && to ? Math.max(1, Math.round((to - from) / 86400000) + 1) : 1

  // Which day of the trip today is, clamped into range.
  const day = from
    ? Math.min(totalDays, Math.max(1, Math.floor((Date.now() - from) / 86400000) + 1))
    : 1

  return {
    city: profile.destination,
    country: profile.country ?? '',
    from: profile.from,
    to: profile.to,
    day,
    totalDays,
    styles: profile.styles ?? [],
    cuisines: profile.cuisines ?? [],
    stays: profile.stays ?? [],
    id: profile.tripId ?? 'trip',
  }
}

/** Onboarding parties -> the families shape used across the app. */
function toFamilies(profile) {
  if (!profile?.parties?.length) return []

  return profile.parties.map((p, i) => {
    const names = (p.members ?? []).map((m) => String(m).trim()).filter(Boolean)
    return {
      id: p.id,
      name: p.name,
      short: p.name.trim().charAt(0) || String(i + 1),
      color: p.color ?? PARTY_COLORS[i % PARTY_COLORS.length],
      // Real names, entered during onboarding.
      members: names.map((name, k) => ({ id: `${p.id}-m${k}`, name })),
      joined: i === 0,
    }
  })
}

export function TripProvider({ children }) {
  const [profile, setProfile] = useState(null)
  // One entry per trip day, so a multi-day trip is the normal case.
  const [days, setDays] = useState({})
  const [activeDay, setActiveDay] = useState(1)
  const [planning, setPlanning] = useState(false)
  const [planWarning, setPlanWarning] = useState(null)

  useEffect(() => {
    loadProfile()
      .then(setProfile)
      .catch((err) => record({ kind: 'db', message: `loadProfile: ${err.message}` }))
  }, [])

  const trip = useMemo(() => toTrip(profile), [profile])
  const families = useMemo(() => toFamilies(profile), [profile])
  const isReal = Boolean(trip)
  const stops = days[activeDay] ?? []

  /** Generates and stores one day's stops. */
  const plan = async (day = activeDay) => {
    if (planning || !trip) return
    setPlanning(true)
    setPlanWarning(null)

    const { stops: fresh, warning } = await buildItinerary({
      trip: { ...trip, day },
      families,
    })

    if (fresh.length > 0) {
      setDays((d) => ({ ...d, [day]: fresh }))
      saveRoute(trip.id, { day, city: trip.city, stops: fresh })
    }
    setPlanWarning(warning ?? null)
    setPlanning(false)
  }

  /** Replaces one day's stops — used by reorder, add and remove. */
  const setDayStops = (day, next) => {
    setDays((d) => ({ ...d, [day]: next }))
    if (trip) saveRoute(trip.id, { day, city: trip.city, stops: next })
  }

  const moveStop = (day, id, delta) => {
    const list = [...(days[day] ?? [])]
    const i = list.findIndex((s) => s.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    breadcrumb('action', `reorder day ${day}`)
    setDayStops(day, list)
  }

  const addStop = (day, stop) => {
    const list = days[day] ?? []
    if (list.some((s) => s.name === stop.name)) return
    // Keep the day in time order after an insert.
    const next = [...list, { ...stop, id: Date.now() }].sort((a, b) =>
      String(a.time).localeCompare(String(b.time))
    )
    breadcrumb('action', `add stop to day ${day}`)
    setDayStops(day, next)
  }

  const removeStop = (day, id) =>
    setDayStops(day, (days[day] ?? []).filter((s) => s.id !== id))

  /* ---- reservations ---- */

  const [reservations, setReservations] = useState([])

  const addReservation = (r) => {
    const entry = { ...r, id: `r${Date.now()}`, createdAt: Date.now() }
    setReservations((list) => [entry, ...list])
    breadcrumb('action', `reservation noted: ${r.place}`)
    return entry
  }

  const removeReservation = (id) =>
    setReservations((list) => list.filter((r) => r.id !== id))

  // Restore whatever is stored, then generate only the days that are missing.
  useEffect(() => {
    if (!trip) return
    let cancelled = false

    listRoutes(trip.id).then((routes) => {
      if (cancelled) return

      const restored = {}
      for (const r of routes) if (r.stops?.length) restored[r.day] = r.stops

      if (Object.keys(restored).length > 0) {
        breadcrumb('data', `${Object.keys(restored).length} days restored`)
        setDays(restored)
        setActiveDay(restored[trip.day] ? trip.day : Number(Object.keys(restored)[0]))
      } else {
        setActiveDay(trip.day)
        plan(trip.day)
      }
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id])

  const completeOnboarding = async (answers) => {
    const next = { ...answers, tripId: `T-${Date.now().toString(36).toUpperCase()}` }
    setProfile(next)
    await saveProfile(next)
    breadcrumb('lifecycle', `onboarding complete: ${answers.destination}`)
  }

  const value = {
    trip,
    stops,
    days,
    activeDay,
    setActiveDay,
    families,
    isReal,
    planning,
    planWarning,
    plan,
    moveStop,
    addStop,
    removeStop,
    reservations,
    addReservation,
    removeReservation,
    profile,
    completeOnboarding,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
