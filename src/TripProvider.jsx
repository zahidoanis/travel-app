import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  TRIP as MOCK_TRIP, STOPS as MOCK_STOPS, FAMILIES as MOCK_FAMILIES, PARTY_COLORS,
} from './data'
import { buildItinerary } from './lib/itinerary'
import { loadProfile, saveProfile, saveRoute, listRoutes } from './lib/db'
import { breadcrumb, record } from './lib/telemetry'

/**
 * Single source of truth for the current trip.
 *
 * Screens read from here instead of importing the fixtures directly, so the
 * same components render the demo trip or a real one the user planned. Until
 * onboarding completes, `trip` is the Paris mock — which keeps every screen
 * populated rather than making each one handle an empty state that only
 * exists for a few seconds.
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

  // Which day of the trip is today, clamped into range.
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
    budget: profile.budget ?? 'mid',
    hotel: profile.hotel ?? '',
    // Weather is still mock — no weather provider wired up yet.
    temp: MOCK_TRIP.temp,
    weather: MOCK_TRIP.weather,
    id: profile.tripId ?? MOCK_TRIP.id,
  }
}

/** Onboarding parties -> the families shape used across the app. */
function toFamilies(profile) {
  if (!profile?.parties?.length) return null

  return profile.parties.map((p, i) => ({
    id: p.id,
    name: p.name,
    short: p.name.trim().charAt(0) || String(i + 1),
    color: p.color ?? PARTY_COLORS[i % PARTY_COLORS.length],
    // One synthetic member per traveller — enough for headcount and splitting.
    members: Array.from({ length: p.size }, (_, k) => `${p.id}-m${k}`),
    joined: i === 0,
  }))
}

export function TripProvider({ children }) {
  const [profile, setProfile] = useState(null)
  // One entry per trip day. The map and the day view read whichever day is
  // selected, so a multi-day trip is the normal case rather than a special one.
  const [days, setDays] = useState({ 1: MOCK_STOPS })
  const [activeDay, setActiveDay] = useState(1)
  const [planning, setPlanning] = useState(false)
  const [planWarning, setPlanWarning] = useState(null)

  useEffect(() => {
    loadProfile()
      .then(setProfile)
      .catch((err) => record({ kind: 'db', message: `loadProfile: ${err.message}` }))
  }, [])

  const trip = useMemo(() => toTrip(profile) ?? MOCK_TRIP, [profile])
  const families = useMemo(() => toFamilies(profile) ?? MOCK_FAMILIES, [profile])
  const isReal = Boolean(profile?.destination)

  const stops = days[activeDay] ?? []

  /** Generates and stores one day's stops. */
  const plan = async (day = activeDay) => {
    if (planning || !isReal) return
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
    saveRoute(trip.id, { day, city: trip.city, stops: next })
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

  // Restore whatever is stored, then generate only the days that are missing.
  useEffect(() => {
    if (!isReal) return
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
        setDays({})
        setActiveDay(1)
        plan(1)
      }
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReal, trip.id])

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
    profile,
    completeOnboarding,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
