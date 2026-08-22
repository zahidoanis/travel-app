import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PARTY_COLORS } from './data'
import { buildItinerary } from './lib/itinerary'
import {
  loadProfile, saveProfile, createTrip, loadTrip, saveTrip, listTrips, joinTrip,
  listRoutes, saveRoute, watchRoutes,
} from './lib/db'
import { onUser, hasFirebase } from './lib/firebase'
import { invitedTripId } from './lib/share'
import { breadcrumb, record } from './lib/telemetry'

/**
 * Single source of truth for the current trip.
 *
 * The trip is a shared document, not something owned by whoever is holding a
 * device. That is what lets the same itinerary appear on a laptop, a phone,
 * and in the hands of everyone invited over WhatsApp.
 *
 * There is deliberately no sample trip behind this — a placeholder itinerary
 * is indistinguishable from a real one that failed to load.
 */
const TripContext = createContext(null)

export const useTrip = () => {
  const ctx = useContext(TripContext)
  if (!ctx) throw new Error('useTrip must be used inside <TripProvider>')
  return ctx
}

/** Stored trip -> the shape the rest of the app expects. */
function toTrip(raw) {
  if (!raw?.destination) return null

  const from = raw.from ? new Date(raw.from) : null
  const to = raw.to ? new Date(raw.to) : null
  const totalDays = from && to ? Math.max(1, Math.round((to - from) / 86400000) + 1) : 1

  const day = from
    ? Math.min(totalDays, Math.max(1, Math.floor((Date.now() - from) / 86400000) + 1))
    : 1

  return {
    id: raw.id,
    code: raw.code ?? '',
    city: raw.destination,
    cityEn: raw.destinationEn ?? raw.destination,
    country: raw.country ?? '',
    from: raw.from,
    to: raw.to,
    day,
    totalDays,
    styles: raw.styles ?? [],
    cuisines: raw.cuisines ?? [],
    stays: raw.stays ?? [],
    flight: raw.flight ?? {},
    memberIds: raw.memberIds ?? [],
  }
}

/** Stored parties -> the families shape used across the app. */
function toFamilies(raw) {
  if (!raw?.parties?.length) return []

  return raw.parties.map((p, i) => {
    const names = (p.members ?? []).map((m) => String(m).trim()).filter(Boolean)
    return {
      id: p.id,
      name: p.name,
      short: p.name.trim().charAt(0) || String(i + 1),
      color: p.color ?? PARTY_COLORS[i % PARTY_COLORS.length],
      members: names.map((name, k) => ({ id: `${p.id}-m${k}`, name })),
      joined: i === 0,
    }
  })
}

export function TripProvider({ children }) {
  const [user, setUser] = useState(null)
  const [raw, setRaw] = useState(null)        // the stored trip document
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState({})
  const [activeDay, setActiveDay] = useState(1)
  const [planning, setPlanning] = useState(false)
  const [planWarning, setPlanWarning] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const stopWatch = useRef(null)

  const trip = useMemo(() => toTrip(raw), [raw])
  const families = useMemo(() => toFamilies(raw), [raw])
  const isReal = Boolean(trip)
  const stops = days[activeDay] ?? []

  /**
   * Sync state, said plainly. A user has to be able to tell whether their
   * work is safe, and the badge that used to sit in the top bar was
   * decorative.
   */
  const syncState = !hasFirebase
    ? 'local'
    : syncing
      ? 'saving'
      : user && !user.anonymous
        ? 'synced'
        : 'device'

  useEffect(() => onUser(setUser), [])

  /* ---- initial load: an invite link wins, then the current trip ---- */
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const invited = invitedTripId()
        const profile = await loadProfile()

        // Arriving through a WhatsApp link joins that trip, even if this
        // device already had one of its own.
        if (invited && invited !== profile.currentTripId) {
          const joined = await joinTrip(invited)
          if (joined && !cancelled) {
            setRaw(joined)
            setLoading(false)
            history.replaceState(null, '', location.pathname)
            return
          }
        }

        const current = invited ?? profile.currentTripId
        const doc = current ? await loadTrip(current) : null
        if (!cancelled) {
          setRaw(doc)
          setLoading(false)
        }
      } catch (err) {
        record({ kind: 'db', message: `trip load: ${err.message}` })
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [])

  /** Signing in can reveal trips this device never saw. */
  useEffect(() => {
    if (!user) return
    listTrips().then(setTrips).catch(() => setTrips([]))
  }, [user])

  /* ---- days ---- */

  // Live, so a stop someone else adds shows up without a refresh.
  useEffect(() => {
    stopWatch.current?.()
    if (!trip) return

    stopWatch.current = watchRoutes(trip.id, (routes) => {
      const next = {}
      for (const r of routes) if (r.stops?.length) next[r.day] = r.stops
      setDays(next)
    })

    setActiveDay(trip.day)
    return () => stopWatch.current?.()
  }, [trip?.id])

  // Generate the current day only when nothing is stored for it.
  useEffect(() => {
    if (!trip || loading) return
    listRoutes(trip.id).then((routes) => {
      if (routes.some((r) => r.day === trip.day && r.stops?.length)) return
      plan(trip.day)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, loading])

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
      persist(day, fresh)
    }
    setPlanWarning(warning ?? null)
    setPlanning(false)
  }

  const persist = async (day, next) => {
    if (!trip) return
    setSyncing(true)
    await saveRoute(trip.id, { day, city: trip.city, stops: next })
    setSyncing(false)
  }

  const setDayStops = (day, next) => {
    setDays((d) => ({ ...d, [day]: next }))
    persist(day, next)
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
    const next = [...list, { ...stop, id: Date.now() }].sort((a, b) =>
      String(a.time).localeCompare(String(b.time))
    )
    breadcrumb('action', `add stop to day ${day}`)
    setDayStops(day, next)
  }

  const removeStop = (day, id) =>
    setDayStops(day, (days[day] ?? []).filter((s) => s.id !== id))

  /** Moves one stop to another day, keeping both days in time order. */
  const moveStopToDay = (fromDay, id, toDay) => {
    if (fromDay === toDay) return
    const stop = (days[fromDay] ?? []).find((s) => s.id === id)
    if (!stop) return

    const remaining = (days[fromDay] ?? []).filter((s) => s.id !== id)
    const target = [...(days[toDay] ?? []), stop].sort((a, b) =>
      String(a.time).localeCompare(String(b.time))
    )

    breadcrumb('action', `move stop ${fromDay} -> ${toDay}`)
    // One state update for both days, so the stop is never briefly duplicated.
    setDays((d) => ({ ...d, [fromDay]: remaining, [toDay]: target }))
    persist(fromDay, remaining)
    persist(toDay, target)
  }

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

  /* ---- trip lifecycle ---- */

  const completeOnboarding = async (answers) => {
    setSyncing(true)
    const { id, code } = await createTrip(answers)
    setRaw({ ...answers, id, code, memberIds: [user?.uid ?? 'local'] })
    setSyncing(false)
    breadcrumb('lifecycle', `trip created: ${answers.destination}`)
  }

  const switchTrip = async (tripId) => {
    setLoading(true)
    const doc = await loadTrip(tripId)
    setRaw(doc)
    await saveProfile({ currentTripId: tripId })
    setLoading(false)
  }

  const updateTrip = async (patch) => {
    if (!trip) return
    setRaw((r) => ({ ...r, ...patch }))
    setSyncing(true)
    await saveTrip(trip.id, patch)
    setSyncing(false)
  }

  const value = {
    user, trip, trips, loading, syncState,
    stops, days, activeDay, setActiveDay,
    families, isReal, planning, planWarning,
    plan, moveStop, addStop, removeStop, moveStopToDay,
    reservations, addReservation, removeReservation,
    profile: raw, completeOnboarding, switchTrip, updateTrip,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
