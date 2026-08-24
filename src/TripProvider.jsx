import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PARTY_COLORS } from './data'
import { buildItinerary } from './lib/itinerary'
import {
  loadProfile, saveProfile, createTrip, loadTrip, saveTrip, listTrips, joinTrip,
  listRoutes, saveRoute, watchRoutes, deleteTrip,
} from './lib/db'
import { onUser, hasFirebase } from './lib/firebase'
import { invitedTripId, extractTripId } from './lib/share'
import { geocode } from './lib/geocode'
import { CITIES } from './cities'
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
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    from: raw.from,
    to: raw.to,
    day,
    totalDays,
    styles: raw.styles ?? [],
    cuisines: raw.cuisines ?? [],
    stays: raw.stays ?? [],
    flight: raw.flight ?? {},
    notes: raw.notes ?? [],
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
  const [skipWelcome, setSkipWelcome] = useState(false)
  // True right after joining someone else's trip — by link or by code —
  // so the app can say once what a new member can actually do here, instead
  // of landing them silently inside someone else's plan with no orientation
  // at all.
  const [justJoined, setJustJoined] = useState(false)
  // Lives here rather than in a screen's own state so every screen can open
  // it — it used to belong to Home alone, which meant switching or starting
  // a trip was reachable only from the one place that happened to render the
  // sheet, and only before signing in hid the button that opened it.
  const [accountOpen, setAccountOpen] = useState(false)
  // Which onboarding step to reopen the trip editor on, or null when closed.
  // A step id (not a plain boolean) so "edit who's traveling" from Home can
  // land directly on that question instead of making someone click through
  // destination and dates first.
  const [editStep, setEditStep] = useState(null)
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
            setJustJoined(true)
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

    // Picking a destination from the city search or a popular-destination
    // card already carries real coordinates; typing a free-text name or
    // taking the agent's suggestion doesn't. One geocode call here — rather
    // than at every place that reads them later — is what lets Home show a
    // real temperature and local time of day regardless of how the
    // destination was chosen.
    let located = answers
    if (answers.lat == null || answers.lng == null) {
      // The curated list first: an exact match is a known-correct answer,
      // zero geocoding risk. It matters here specifically because geocoding
      // the Hebrew destination text directly is not reliable — "פראג, צ'כיה"
      // returned a bus stop in Or Akiva, not Prague, with no error and no
      // way to tell from the result alone that it was wrong. destinationEn
      // (set for the search-hit and popular-card paths) sidesteps that; a
      // free-typed Hebrew name with no curated match is the one case left
      // exposed to it.
      const known = CITIES.find(
        (c) => c.he === answers.destination || (answers.destinationEn && c.en === answers.destinationEn)
      )
      if (known) {
        located = { ...answers, lat: known.lat, lng: known.lng }
      } else {
        const hit = await geocode(answers.destinationEn ?? answers.destination, answers.country)
        located = { ...answers, lat: hit?.lat ?? null, lng: hit?.lng ?? null }
      }
    }

    const { id, code } = await createTrip(located)
    setRaw({ ...located, id, code, memberIds: [user?.uid ?? 'local'] })
    setSyncing(false)
    breadcrumb('lifecycle', `trip created: ${answers.destination}`)
  }

  /**
   * Drops back to onboarding to plan a second trip. The current one is not
   * touched — createTrip() always writes a new document rather than
   * overwriting — so it stays reachable afterwards through the account
   * sheet's trip list for anyone signed in. For a local-only session there
   * is no list to bring it back from, which is why the UI warns before this
   * runs rather than after.
   */
  const startNewTrip = () => {
    breadcrumb('lifecycle', 'starting a new trip')
    setSkipWelcome(true)
    setRaw(null)
    setDays({})
  }

  /**
   * Joins a trip from a pasted code rather than an opened link — the same
   * `joinTrip` a WhatsApp invite link drives, just entered by hand. Returns
   * whether it worked, since a wrong or already-used code is an everyday
   * mistake here, not an error to log.
   */
  const joinByCode = async (input) => {
    if (!input.trim()) return { ok: false, message: 'הזן קוד או קישור הצטרפות' }
    const tripId = extractTripId(input)

    setSyncing(true)
    const joined = await joinTrip(tripId)
    setSyncing(false)

    if (!joined) return { ok: false, message: 'הקוד לא נמצא, או שאין הרשאה להצטרף' }

    setRaw(joined)
    setJustJoined(true)
    breadcrumb('lifecycle', `joined trip via code`)
    return { ok: true }
  }

  const switchTrip = async (tripId) => {
    setLoading(true)
    const doc = await loadTrip(tripId)
    setRaw(doc)
    await saveProfile({ currentTripId: tripId })
    setLoading(false)
  }

  /**
   * Deletes a trip outright — not "leave it behind" like startNewTrip, gone
   * for everyone on it. The rules enforce owner-only server-side; this just
   * decides what the screen shows next, since the trip being deleted might
   * be the one currently open.
   */
  const removeTrip = async (tripId) => {
    const ok = await deleteTrip(tripId)
    // A `false` here means either "no backend, deleted locally as intended"
    // or "the write was actually rejected" (a non-owner member, most
    // realistically — firebase.rules restricts delete to the owner, which
    // the account sheet was not checking before showing this button at
    // all). Only the second one is a failure; treating both the same would
    // have the trip vanish from this device's list while it is still very
    // much there for everyone else, then reappear next time it reloads.
    if (!ok && hasFirebase) return { ok: false }

    setTrips((list) => list.filter((t) => t.id !== tripId))

    if (trip?.id === tripId) {
      const next = trips.find((t) => t.id !== tripId)
      if (next) {
        await switchTrip(next.id)
      } else {
        setRaw(null)
        await saveProfile({ currentTripId: null })
      }
    }

    return { ok: true }
  }

  const updateTrip = async (patch) => {
    if (!trip) return false
    setRaw((r) => ({ ...r, ...patch }))
    setSyncing(true)
    // The local view above updates optimistically either way — that part of
    // the trade is deliberate, it's why edits feel instant. What was missing
    // was any way for the caller to notice a `false` here and say so, so a
    // save that silently failed looked identical to one that worked right up
    // until the next real read quietly reverted it.
    const ok = await saveTrip(trip.id, patch)
    setSyncing(false)
    return ok
  }

  /**
   * Short, general-purpose notes about the trip — a driver's name, a booking
   * code, anything that isn't tied to one stop on the map and so has no
   * other home. A short list rather than one growing block of text, so an
   * unrelated reminder doesn't get buried inside someone else's paragraph.
   */
  const addNote = (text) => {
    const trimmed = text.trim()
    if (!trimmed || !trip) return
    return updateTrip({ notes: [...trip.notes, { id: `n${Date.now()}`, text: trimmed }] })
  }

  const updateNote = (id, text) => {
    const trimmed = text.trim()
    if (!trimmed || !trip) return
    return updateTrip({ notes: trip.notes.map((n) => (n.id === id ? { ...n, text: trimmed } : n)) })
  }

  const removeNote = (id) => {
    if (!trip) return
    return updateTrip({ notes: trip.notes.filter((n) => n.id !== id) })
  }

  const value = {
    user, trip, trips, loading, syncState, skipWelcome,
    stops, days, activeDay, setActiveDay,
    families, isReal, planning, planWarning,
    plan, moveStop, addStop, removeStop, moveStopToDay,
    reservations, addReservation, removeReservation,
    profile: raw, completeOnboarding, switchTrip, updateTrip, startNewTrip, joinByCode, removeTrip,
    addNote, updateNote, removeNote,
    accountOpen,
    openAccount: () => setAccountOpen(true),
    closeAccount: () => setAccountOpen(false),
    editStep,
    openEdit: (step = 'where') => setEditStep(step),
    closeEdit: () => setEditStep(null),
    justJoined,
    dismissJustJoined: () => setJustJoined(false),
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
