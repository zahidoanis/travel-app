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
  const [stops, setStops] = useState(MOCK_STOPS)
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

  /** Generates and stores the day's stops for the chosen city. */
  const plan = async () => {
    if (planning || !isReal) return
    setPlanning(true)
    setPlanWarning(null)

    const { stops: fresh, warning } = await buildItinerary({ trip, families })

    if (fresh.length > 0) {
      setStops(fresh)
      saveRoute(trip.id, { day: trip.day, city: trip.city, stops: fresh })
    }
    setPlanWarning(warning ?? null)
    setPlanning(false)
  }

  // On first arrival with a real destination, reuse a stored route if there is
  // one and only call the model when there isn't.
  useEffect(() => {
    if (!isReal) return
    let cancelled = false

    listRoutes(trip.id).then((routes) => {
      if (cancelled) return
      const stored = routes.find((r) => r.day === trip.day)
      if (stored?.stops?.length) {
        breadcrumb('data', `route restored for day ${trip.day}`)
        setStops(stored.stops)
      } else {
        plan()
      }
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReal, trip.id, trip.day])

  const completeOnboarding = async (answers) => {
    const next = { ...answers, tripId: `T-${Date.now().toString(36).toUpperCase()}` }
    setProfile(next)
    await saveProfile(next)
    breadcrumb('lifecycle', `onboarding complete: ${answers.destination}`)
  }

  const value = {
    trip,
    stops,
    families,
    isReal,
    planning,
    planWarning,
    plan,
    profile,
    completeOnboarding,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
