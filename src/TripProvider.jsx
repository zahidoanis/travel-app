import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PARTY_COLORS, memberName, memberAge } from './data'
import { buildItinerary } from './lib/itinerary'
import {
  loadProfile, saveProfile, createTrip, loadTrip, saveTrip, listTrips, joinTrip,
  listRoutes, saveRoute, watchRoutes, deleteTrip, logActivity, watchActivity,
  updatePresence, watchPresence,
} from './lib/db'
import { onUser, hasFirebase } from './lib/firebase'
import { invitedTripId } from './lib/share'
import { geocode } from './lib/geocode'
import { hasAI, systemPrompt, streamReply } from './lib/gemini'
import { CITIES } from './cities'
import { breadcrumb, record } from './lib/telemetry'

// Firestore's free tier has a real daily write budget shared by every
// feature, not just this one — a location fires far more often than a
// person actually needs their dot on the map to move.
const PRESENCE_WRITE_MS = 45000

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

/**
 * The trip's own from/to (set early in onboarding, before any family beyond
 * the first even exists) is only ever a starting guess — a second family
 * arriving earlier or staying later is exactly as real a part of the trip,
 * so the range everything else is computed against has to be the union
 * across every family's arrival/departure, not just the nominal dates.
 */
function effectiveRange(raw) {
  let from = raw?.from ?? null
  let to = raw?.to ?? null
  for (const p of raw?.parties ?? []) {
    const arrive = p.arriveAt?.split('T')[0]
    const depart = p.departAt?.split('T')[0]
    if (arrive && (!from || arrive < from)) from = arrive
    if (depart && (!to || depart > to)) to = depart
  }
  return { from, to }
}

/** Stored trip -> the shape the rest of the app expects. */
function toTrip(raw) {
  if (!raw?.destination) return null

  const { from: fromStr, to: toStr } = effectiveRange(raw)
  const from = fromStr ? new Date(fromStr) : null
  const to = toStr ? new Date(toStr) : null
  const totalDays = from && to ? Math.max(1, Math.round((to - from) / 86400000) + 1) : 1

  const day = from
    ? Math.min(totalDays, Math.max(1, Math.floor((Date.now() - from) / 86400000) + 1))
    : 1

  return {
    id: raw.id,
    code: raw.code ?? '',
    ownerId: raw.ownerId ?? null,
    city: raw.destination,
    cityEn: raw.destinationEn ?? raw.destination,
    country: raw.country ?? '',
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    // The effective (possibly widened) range — not raw.from/raw.to
    // verbatim, since a family outside the nominal dates is still really
    // part of the trip and every day-number everywhere is anchored to this.
    from: fromStr,
    to: toStr,
    day,
    totalDays,
    styles: raw.styles ?? [],
    cuisines: raw.cuisines ?? [],
    stays: raw.stays ?? [],
    flight: raw.flight ?? {},
    notes: raw.notes ?? [],
    expenses: raw.expenses ?? [],
    memberIds: raw.memberIds ?? [],
  }
}

/**
 * Which day of the trip a "YYYY-MM-DDTHH:MM" datetime falls on. Only the
 * date half is used — mixing a bare date (parsed as UTC midnight, same as
 * trip.from/to elsewhere) with a datetime-local value (parsed in the
 * viewer's own timezone) would drift the day number near midnight depending
 * on where the viewer actually is. The time itself is for display only.
 */
function dayNumberFromDate(fromISO, dateTimeStr) {
  if (!fromISO || !dateTimeStr) return null
  const from = new Date(fromISO)
  const d = new Date(dateTimeStr.split('T')[0])
  return Math.round((d - from) / 86400000) + 1
}

/** Stored parties -> the families shape used across the app. */
function toFamilies(raw) {
  if (!raw?.parties?.length) return []

  // Anchored to the same effective (possibly widened) start toTrip() uses —
  // day numbers have to agree with each other, or a family arriving before
  // the trip's nominal start would land on day 0 or negative.
  const { from: effectiveFrom } = effectiveRange(raw)

  return raw.parties.map((p, i) => {
    const named = (p.members ?? [])
      .map((m) => ({ name: memberName(m).trim(), age: memberAge(m) }))
      .filter((m) => m.name)
    const arriveDay = dayNumberFromDate(effectiveFrom, p.arriveAt) ?? 1
    const rawDepartDay = dayNumberFromDate(effectiveFrom, p.departAt)
    return {
      id: p.id,
      name: p.name,
      short: p.name.trim().charAt(0) || String(i + 1),
      color: p.color ?? PARTY_COLORS[i % PARTY_COLORS.length],
      members: named.map((m, k) => ({ id: `${p.id}-m${k}`, name: m.name, age: m.age })),
      joined: i === 0,
      // The exact date+time, for display — "מגיעים ב-25.8 בשעה 14:30".
      arriveAt: p.arriveAt ?? null,
      departAt: p.departAt ?? null,
      // Which day of the trip that falls on, for bounding the day switcher —
      // null departDay means "through the end of the trip", resolved by
      // whoever reads it against the actual trip length. A departure typed
      // in before the arrival (a mis-set date-picker field, easy to do by
      // accident) must not turn into a negative bound — that collapses the
      // day switcher to nothing, hiding every day but whichever was already
      // loaded. Treated as "unset" instead of trusted as-is.
      arriveDay,
      departDay: rawDepartDay != null && rawDepartDay >= arriveDay ? rawDepartDay : null,
      sharedDays: p.sharedDays ?? [],
    }
  })
}

export function TripProvider({ children }) {
  const [user, setUser] = useState(null)
  const [raw, setRaw] = useState(null)        // the stored trip document
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  // Split in two: a family's own private days, and the days everyone doing
  // a shared day opts into together. Which bucket a given day actually
  // comes from is decided per day below, once `families` (and so each
  // family's own sharedDays list) exists.
  const [ownDays, setOwnDays] = useState({})
  const [sharedRoutes, setSharedRoutes] = useState({})
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
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [activity, setActivity] = useState([])
  const activityWatch = useRef(null)
  const stopWatch = useRef(null)
  const sharedWatch = useRef(null)

  const trip = useMemo(() => toTrip(raw), [raw])
  const families = useMemo(() => toFamilies(raw), [raw])
  const isReal = Boolean(trip)

  /**
   * Each family plans its own days independently rather than sharing one
   * itinerary — a parent checking what the grandparents planned separately
   * is a real, common shape for a multi-family trip. `families[0]` is
   * always "your own" (toFamilies marks it `joined: true`), so that's what
   * opening Days or the map shows by default; switching to another family's
   * plan is explicit.
   */
  const [activeFamily, setActiveFamily] = useState(null)
  useEffect(() => {
    // A device that already said "I'm family X" for this trip — set once,
    // right after joining via the family picker — opens straight to that
    // family's plan on every later visit, not always back to families[0].
    const saved = trip ? localStorage.getItem(`tripai.myFamily.${trip.id}`) : null
    const stillReal = saved && families.some((f) => f.id === saved)
    setActiveFamily(stillReal ? saved : families[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id])
  const switchFamily = (id) => {
    // Day 1 isn't necessarily this family's day at all — someone joining a
    // multi-family trip partway through would land on a day they were never
    // on, showing an empty plan that looks broken rather than just early.
    setActiveDay(families.find((f) => f.id === id)?.arriveDay ?? 1)
    setActiveFamily(id)
  }

  /** Remembers "this device is family X" for next time, then switches to it —
   *  used once, right after the join-family picker resolves. */
  const setMyFamily = (id) => {
    if (trip) localStorage.setItem(`tripai.myFamily.${trip.id}`, id)
    switchFamily(id)
  }

  /**
   * A brand new family joining an existing trip — someone who wasn't part
   * of the original "who's traveling" list, entering their own real
   * details rather than having the trip's creator guess on their behalf.
   */
  const addFamily = async ({ name, members, arriveAt, departAt }) => {
    if (!trip) return null
    const id = `p${Date.now()}`
    const party = {
      id,
      name: name.trim(),
      members: members.map((m) => m.trim()).filter(Boolean).map((m) => ({ name: m, age: '' })),
      color: PARTY_COLORS[(raw.parties?.length ?? 0) % PARTY_COLORS.length],
      arriveAt: arriveAt || null,
      departAt: departAt || null,
    }
    const ok = await updateTrip({ parties: [...(raw.parties ?? []), party] })
    return ok ? id : null
  }

  const activeFamilyObj = families.find((f) => f.id === activeFamily) ?? null
  const sharedDaySet = new Set(activeFamilyObj?.sharedDays ?? [])

  /**
   * Opts one day in or out of the shared plan, for whichever family is
   * currently active. Two families both marking the same day "together"
   * land on the identical shared bucket without either one having to be
   * "the host" — there's nothing to reconcile, they were always pointed at
   * the same document once both flags are set.
   */
  const toggleSharedDay = (day) => {
    if (!trip || !activeFamily) return
    const parties = (raw.parties ?? []).map((p) => {
      if (p.id !== activeFamily) return p
      const set = new Set(p.sharedDays ?? [])
      if (set.has(day)) set.delete(day)
      else set.add(day)
      return { ...p, sharedDays: [...set].sort((a, b) => a - b) }
    })
    return updateTrip({ parties })
  }

  /**
   * The active family's real day list — their own days, except wherever
   * they've opted a specific day into the shared plan, which then shows
   * (and is edited as) exactly what every other family who joined that same
   * day sees. Two families each toggling day 3 "together" both land on this
   * same merged view of day 3, from the one shared bucket.
   */
  const days = useMemo(() => {
    const merged = { ...ownDays }
    for (const day of sharedDaySet) merged[day] = sharedRoutes[day] ?? []
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownDays, sharedRoutes, activeFamilyObj?.sharedDays])

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
            logActivity(joined.id, { type: 'join', message: `${user?.name || 'מישהו'} הצטרף/ה לטיול` })
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

  useEffect(() => {
    if (trip) setActiveDay(trip.day)
  }, [trip?.id])

  // Live, so a stop someone else in the same family adds shows up without a
  // refresh. Keyed on activeFamily too — switching whose plan is showing is
  // a different set of documents entirely, not a filter over one shared set.
  useEffect(() => {
    stopWatch.current?.()
    if (!trip || !activeFamily) return

    stopWatch.current = watchRoutes(trip.id, activeFamily, (routes) => {
      const next = {}
      for (const r of routes) if (r.stops?.length) next[r.day] = r.stops
      setOwnDays(next)
    })

    return () => stopWatch.current?.()
  }, [trip?.id, activeFamily])

  // The shared bucket is watched independently of whether the active family
  // has actually opted any day into it yet — switching a day into "together"
  // needs its data to already be flowing, not fetched only after the fact.
  useEffect(() => {
    sharedWatch.current?.()
    if (!trip) return

    sharedWatch.current = watchRoutes(trip.id, 'shared', (routes) => {
      const next = {}
      for (const r of routes) if (r.stops?.length) next[r.day] = r.stops
      setSharedRoutes(next)
    })

    return () => sharedWatch.current?.()
  }, [trip?.id])

  /* ---- activity feed, for the bell ---- */

  useEffect(() => {
    activityWatch.current?.()
    if (!trip) return
    activityWatch.current = watchActivity(trip.id, setActivity)
    return () => activityWatch.current?.()
  }, [trip?.id])

  // Marked read the moment the sheet opens, not on some later "mark all
  // read" action nobody would find — local per device, not synced, so
  // opening the bell on your phone doesn't clear the dot on your laptop.
  const lastSeenKey = trip ? `tripai.lastSeen.${trip.id}` : null
  const [lastSeen, setLastSeen] = useState(0)
  useEffect(() => {
    if (!lastSeenKey) return
    setLastSeen(Number(localStorage.getItem(lastSeenKey) ?? 0))
  }, [lastSeenKey])

  const unreadCount = activity.filter((a) => (a.createdAt?.seconds ?? 0) * 1000 > lastSeen).length

  const openNotifications = () => {
    setNotificationsOpen(true)
    if (lastSeenKey) {
      const now = Date.now()
      localStorage.setItem(lastSeenKey, String(now))
      setLastSeen(now)
    }
  }

  /**
   * The AI chat's own state, lifted here rather than left in Chat.jsx —
   * switching to another tab used to unmount it, and with it the whole
   * conversation. Living here instead means an in-flight reply keeps
   * streaming even while looking at the map, not just that the history
   * survives.
   */
  const [chatMessages, setChatMessages] = useState([])
  const [chatDraft, setChatDraft] = useState('')
  const [chatTyping, setChatTyping] = useState(false)
  const [chatError, setChatError] = useState(null)
  const chatAbort = useRef(null)

  // A new trip is a new conversation — the old one was about a different
  // itinerary and would confuse the agent as much as the person reading it.
  useEffect(() => {
    chatAbort.current?.abort()
    setChatMessages([])
    setChatDraft('')
    setChatTyping(false)
    setChatError(null)
  }, [trip?.id])

  useEffect(() => () => chatAbort.current?.abort(), [])

  // The model puts this as the literal first line of its reply when the
  // user asked it to actually plan/build/replace one or more full days —
  // see the "יכולת מיוחדת" block in systemPrompt(). Caught here rather than
  // shown to the user, then acted on for real via the same plan() every
  // other "בנה מסלול מחדש" button already calls.
  const PLAN_DAYS_MARKER = /^\s*PLAN_DAYS:\s*([\d,\s]+)/i

  const askAgent = async (history) => {
    const controller = new AbortController()
    chatAbort.current = controller
    setChatError(null)
    setChatTyping(true)

    const system = systemPrompt({ trip, stops, families })

    try {
      // Buffered rather than shown chunk-by-chunk like before: the marker
      // has to be caught before anything renders, which means knowing the
      // whole reply first. The cost is losing the live-typing animation for
      // chat replies; the alternative was risking "PLAN_DAYS: 1,2,3" flashing
      // on screen as if it were the agent talking to the user directly.
      let full = ''
      await streamReply({
        messages: history,
        system,
        signal: controller.signal,
        onChunk: (delta) => { full += delta },
      })

      const match = full.match(PLAN_DAYS_MARKER)
      const wantsDays = match && trip
        ? [...new Set(
            match[1].split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => n >= 1 && n <= trip.totalDays)
          )]
        : []
      const rest = match ? full.slice(match[0].length).trim() : full

      if (wantsDays.length > 0) {
        breadcrumb('action', `chat planned days ${wantsDays.join(',')}`)
        for (const day of wantsDays) await plan(day)
        const confirm = rest || (wantsDays.length === 1
          ? `בניתי מסלול חדש ליום ${wantsDays[0]}.`
          : `בניתי מסלול חדש לימים ${wantsDays.join(', ')}.`)
        setChatMessages((m) => [...m, {
          id: `a${Date.now()}`, role: 'ai',
          text: `${confirm}\n\nאפשר לראות את זה במסך "מסלול הטיול".`,
        }])
      } else {
        setChatMessages((m) => [...m, { id: `a${Date.now()}`, role: 'ai', text: rest }])
      }
    } catch (err) {
      if (err?.name !== 'AbortError') setChatError(err.message)
    } finally {
      setChatTyping(false)
      chatAbort.current = null
    }
  }

  const sendChatMessage = (overrideText) => {
    const text = (overrideText ?? chatDraft).trim()
    if (!text || chatTyping) return
    breadcrumb('action', 'chat message sent')
    setChatDraft('')
    const mine = { id: `u${Date.now()}`, role: 'me', text }
    const history = [...chatMessages, mine]
    setChatMessages(history)
    if (hasAI) askAgent(history)
    else setChatError('הסוכן אינו מחובר כרגע.')
  }

  /** Re-runs the last question, dropping the failed exchange. */
  const retryChatMessage = () => {
    const lastMine = [...chatMessages].reverse().find((m) => m.role === 'me')
    if (!lastMine) return
    const upTo = chatMessages.slice(0, chatMessages.lastIndexOf(lastMine) + 1)
    setChatMessages(upTo)
    askAgent(upTo)
  }

  /* ---- live location, opt-in per device per trip ---- */

  const [presence, setPresence] = useState([])
  const presenceWatch = useRef(null)
  useEffect(() => {
    presenceWatch.current?.()
    if (!trip) return
    presenceWatch.current = watchPresence(trip.id, setPresence)
    return () => presenceWatch.current?.()
  }, [trip?.id])

  const sharingKey = trip ? `tripai.shareLoc.${trip.id}` : null
  const [sharingLocation, setSharingLocation] = useState(false)
  useEffect(() => {
    setSharingLocation(sharingKey ? localStorage.getItem(sharingKey) === '1' : false)
  }, [sharingKey])

  const lastWriteAt = useRef(0)

  const toggleLocationSharing = () => {
    if (!trip || !sharingKey) return
    const next = !sharingLocation
    setSharingLocation(next)
    localStorage.setItem(sharingKey, next ? '1' : '0')
    if (!next) updatePresence(trip.id, user?.uid, { active: false })
  }

  useEffect(() => {
    if (!sharingLocation || !trip || typeof navigator === 'undefined' || !navigator.geolocation) return

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastWriteAt.current < PRESENCE_WRITE_MS) return
        lastWriteAt.current = now
        updatePresence(trip.id, user?.uid, {
          name: user?.name || 'מישהו',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          active: true,
        })
      },
      (err) => record({ kind: 'geo', level: 'warn', message: `geolocation: ${err.message}` }),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [sharingLocation, trip?.id, user?.uid])

  // Generate the current day only when nothing is stored for it — for
  // whichever family is active, since switching to a family that hasn't
  // planned yet is exactly the same "nothing stored" situation as opening
  // the trip for the first time.
  useEffect(() => {
    if (!trip || !activeFamily || loading) return
    const bucket = sharedDaySet.has(trip.day) ? 'shared' : activeFamily
    listRoutes(trip.id, bucket).then((routes) => {
      if (routes.some((r) => r.day === trip.day && r.stops?.length)) return
      plan(trip.day)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, activeFamily, loading])

  const plan = async (day = activeDay) => {
    if (planning || !trip || !activeFamily) return
    setPlanning(true)
    setPlanWarning(null)

    const planningFamily = families.find((f) => f.id === activeFamily)
    // What this family already has on its OTHER days — without this, asking
    // for several days in one go (the chat's "plan 4 days") generated each
    // one blind to the rest, and a well-known city's "obvious" top picks
    // landed on more than one day.
    const already = Object.entries(days)
      .filter(([d]) => Number(d) !== day)
      .flatMap(([, list]) => list.map((s) => s.he || s.name))

    const { stops: fresh, warning } = await buildItinerary({
      trip: { ...trip, day },
      families: planningFamily ? [planningFamily] : families,
      already,
    })

    if (fresh.length > 0) {
      applyLocalDay(day, fresh)
      persist(day, fresh)
    }
    setPlanWarning(warning ?? null)
    setPlanning(false)
  }

  const persist = async (day, next) => {
    if (!trip || !activeFamily) return
    setSyncing(true)
    const bucket = sharedDaySet.has(day) ? 'shared' : activeFamily
    await saveRoute(trip.id, bucket, { day, city: trip.city, stops: next })
    setSyncing(false)
  }

  /** Updates whichever local bucket (own or shared) actually backs this day,
   *  matching persist()'s choice of where the write itself goes. */
  const applyLocalDay = (day, next) => {
    if (sharedDaySet.has(day)) setSharedRoutes((d) => ({ ...d, [day]: next }))
    else setOwnDays((d) => ({ ...d, [day]: next }))
  }

  const setDayStops = (day, next) => {
    applyLocalDay(day, next)
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

  // No login requirement in this app means no reliable name for whoever is
  // acting — an anonymous session just says so rather than attributing the
  // change to nobody in particular.
  const whoami = () => user?.name || 'מישהו בטיול'

  const addStop = (day, stop) => {
    const list = days[day] ?? []
    if (list.some((s) => s.name === stop.name)) return
    const next = [...list, { ...stop, id: Date.now() }].sort((a, b) =>
      String(a.time).localeCompare(String(b.time))
    )
    breadcrumb('action', `add stop to day ${day}`)
    setDayStops(day, next)
    if (trip) {
      logActivity(trip.id, { type: 'stop', message: `${whoami()} הוסיף/ה עצירה ליום ${day}: ${stop.he ?? stop.name}` })
    }
  }

  const removeStop = (day, id) => {
    const removed = (days[day] ?? []).find((s) => s.id === id)
    setDayStops(day, (days[day] ?? []).filter((s) => s.id !== id))
    if (trip && removed) {
      logActivity(trip.id, { type: 'stop', message: `${whoami()} הסיר/ה עצירה מיום ${day}: ${removed.he ?? removed.name}` })
    }
  }

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
    applyLocalDay(fromDay, remaining)
    applyLocalDay(toDay, target)
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
    const ownerId = user?.uid ?? 'local'
    const created = { ...located, id, code, ownerId, memberIds: [ownerId] }
    setRaw(created)
    // Only the [user] effect below refetches this list, so it never changing
    // (this device was already signed in) left a trip created mid-session
    // invisible in "הטיולים שלך" until the next sign-in or reload — even
    // though it saved correctly. Prepending here keeps the list honest
    // without a second round trip to fetch what was just created locally.
    setTrips((list) => [created, ...list.filter((t) => t.id !== id)])
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
    setOwnDays({})
    setSharedRoutes({})
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
    logActivity(trip.id, { type: 'note', message: `${whoami()} הוסיף/ה הערה: ${trimmed}` })
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

  /**
   * Shared expenses, for the split-the-bill screen. These used to live only
   * in that screen's own useState — real spending that vanished the moment
   * the tab closed or the app was reopened, with nothing to say it hadn't
   * saved.
   */
  const addExpense = (expense) => {
    if (!trip) return
    return updateTrip({ expenses: [expense, ...trip.expenses] })
  }

  const updateExpense = (id, patch) => {
    if (!trip) return
    return updateTrip({ expenses: trip.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  }

  const removeExpense = (id) => {
    if (!trip) return
    return updateTrip({ expenses: trip.expenses.filter((e) => e.id !== id) })
  }

  /**
   * Places to sleep. More than one is normal — a trip that moves between
   * cities, or a family that splits up for part of it — so each stay carries
   * its own optional date range rather than the trip having one hotel.
   */
  const addStay = (stay) => {
    if (!trip || trip.stays.some((s) => s.label === stay.label)) return
    return updateTrip({ stays: [...trip.stays, stay] })
  }

  const updateStay = (label, patch) => {
    if (!trip) return
    return updateTrip({ stays: trip.stays.map((s) => (s.label === label ? { ...s, ...patch } : s)) })
  }

  const removeStay = (label) => {
    if (!trip) return
    return updateTrip({ stays: trip.stays.filter((s) => s.label !== label) })
  }

  const value = {
    user, trip, trips, loading, syncState, skipWelcome,
    stops, days, activeDay, setActiveDay, activeFamily, switchFamily,
    sharedDaySet, toggleSharedDay, setMyFamily, addFamily,
    families, isReal, planning, planWarning,
    plan, moveStop, addStop, removeStop, moveStopToDay,
    reservations, addReservation, removeReservation,
    profile: raw, completeOnboarding, switchTrip, updateTrip, startNewTrip, removeTrip,
    addNote, updateNote, removeNote,
    addExpense, updateExpense, removeExpense,
    addStay, updateStay, removeStay,
    accountOpen,
    openAccount: () => setAccountOpen(true),
    closeAccount: () => setAccountOpen(false),
    editStep,
    openEdit: (step = 'where') => setEditStep(step),
    closeEdit: () => setEditStep(null),
    justJoined,
    dismissJustJoined: () => setJustJoined(false),
    activity, unreadCount, notificationsOpen, openNotifications,
    closeNotifications: () => setNotificationsOpen(false),
    presence, sharingLocation, toggleLocationSharing,
    chatMessages, chatDraft, setChatDraft, chatTyping, chatError,
    sendChatMessage, retryChatMessage,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
