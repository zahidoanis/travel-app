import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { PARTY_COLORS, memberName, memberAge } from './data'
import { buildItinerary, normaliseCategory } from './lib/itinerary'
import {
  loadProfile, saveProfile, createTrip, loadTrip, saveTrip, listTrips, joinTrip,
  listRoutes, saveRoute, watchRoutes, deleteTrip, logActivity, watchActivity,
  updatePresence, watchPresence, deleteTicketPhoto, watchTrip, mutateTripList,
} from './lib/db'
import { todayISO, daysBetween } from './lib/dates'
import { newId } from './lib/ids'
import { useConfirm } from './components/Confirm'
import { onUser, hasFirebase } from './lib/firebase'
import { invitedTripId, invitedToken } from './lib/share'
import { geocode, geocodeNear } from './lib/geocode'
import { importedStops, importSpan } from './lib/mapImport'
import { hasAI, systemPrompt, streamReply, OPENER_PROMPT } from './lib/gemini'
import { fetchForecast, fetchClimateAverage } from './lib/weather'
import { CITIES } from './cities'
import { placeNames } from './lib/placeNames'
import { breadcrumb, record } from './lib/telemetry'
import { t } from './i18n'

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

  // Counted in calendar dates on this device, not in elapsed milliseconds
  // since UTC midnight — that kept a trip on day 1 until 2 or 3 in the
  // morning of day 2, Israel time.
  const day = fromStr
    ? Math.min(totalDays, Math.max(1, daysBetween(fromStr, todayISO()) + 1))
    : 1

  const { city, country, cityEn } = placeNames(raw)

  return {
    id: raw.id,
    code: raw.code ?? '',
    inviteToken: raw.inviteToken ?? null,
    ownerId: raw.ownerId ?? null,
    city,
    cityEn,
    country,
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
    reservations: raw.reservations ?? [],
    // What the chat agent has learned about the group (REMEMBER lines).
    memory: raw.memory ?? [],
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
    // Not filtered by name any more — a headcount with no name at all is
    // the normal case now, and dropping nameless members here would make
    // every "X נוסעים" figure across the app undercount (or read zero).
    const named = (p.members ?? [])
      .map((m) => ({ name: memberName(m).trim(), age: memberAge(m) }))
    const arriveDay = dayNumberFromDate(effectiveFrom, p.arriveAt) ?? 1
    const rawDepartDay = dayNumberFromDate(effectiveFrom, p.departAt)
    return {
      id: p.id,
      name: p.name,
      short: p.name.trim().charAt(0) || String(i + 1),
      color: p.color ?? PARTY_COLORS[i % PARTY_COLORS.length],
      members: named.map((m, k) => ({ id: `${p.id}-m${k}`, name: m.name, age: m.age })),
      // The creator's own family is on the trip by definition; every other
      // one is marked when someone actually picks it after joining (see
      // setMyFamily). This used to be `i === 0` and nothing else, so the
      // share sheet showed every invited family as "waiting" forever.
      joined: i === 0 || Boolean(p.joined),
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

// A weather question used to get whatever Gemini's training data happened to
// hold — plausible-sounding, ungrounded, and not the same number Home shows
// for the very same trip. Home already fetches the real thing (a live
// forecast, or a historical average for a trip too far out for one); the chat
// agent gets no tools at all, by design (see systemPrompt's "no live access"
// rule), so this catches a weather question before the request goes out and
// hands the model that same real reading as grounded context instead. A
// missed match just falls back to the honest "no live access" line the
// system prompt already gives — same imprecise-on-purpose trade the server's
// NEEDS_SEARCH trigger makes, and no `\b` around the Hebrew tokens because JS
// regex word boundaries are Latin-only and silently no-op on Hebrew text.
const WEATHER_TRIGGER = new RegExp(
  [
    'מזג( ה)?אוויר', 'טמפרטורה', 'מעלות', 'גשם', 'שלג', 'קריר', 'תחזית', // i18n-ignore — matches user input
    'כמה חם', 'כמה קר', // i18n-ignore
    '\\bweather\\b', '\\btemperature\\b', '\\bforecast\\b', '\\bclimate\\b',
    '\\brain(y|ing)?\\b', '\\bsnow(y|ing)?\\b', '\\bdegrees?\\b', '\\bcelsius\\b',
    '\\bhot\\b', '\\bcold\\b', '\\bsunny\\b',
  ].join('|'),
  'i'
)

/**
 * The same real reading Home's hero card shows for this trip — a live
 * forecast within Open-Meteo's ~week horizon, a historical climate average
 * beyond it — shaped for the system prompt rather than the UI. Null when
 * there's no way to place the trip on a map at all; the chat then falls back
 * to the model's own honest "I don't have live access" line, same as before
 * this existed.
 */
async function fetchTripWeather(trip) {
  if (!trip) return null

  let { lat, lng } = trip
  if (lat == null || lng == null) {
    const known = CITIES.find((c) => c.he === trip.city || c.en === trip.cityEn)
    if (known) {
      lat = known.lat
      lng = known.lng
    } else {
      const hit = await geocode(trip.cityEn ?? trip.city, trip.country)
      lat = hit?.lat ?? null
      lng = hit?.lng ?? null
    }
  }
  if (lat == null || lng == null) return null

  const daysUntil = (() => {
    if (!trip.from) return 0
    const [y, m, d] = trip.from.split('-').map(Number)
    const target = new Date(y, m - 1, d)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.round((target - today) / 86400000)
  })()

  // Beyond about a week out, "today's weather there" has nothing to do with
  // the trip's actual dates — same cutoff and reasoning as Home's hero card.
  if (trip.from && daysUntil > 7) {
    const [, month, day] = trip.from.split('-').map(Number)
    const c = await fetchClimateAverage(lat, lng, month, day)
    return c ? { kind: 'climate', city: trip.city, ...c } : null
  }

  const f = await fetchForecast(lat, lng)
  return f ? { kind: 'forecast', city: trip.city, ...f } : null
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
  // One short message at the bottom of the screen, optionally with a single
  // action — "stop removed · undo", "that invite link is no longer valid".
  // When the message is about a change to the itinerary it also carries
  // what the days held before, so the action can put them back:
  // { text, action?, undo?: { family, days: { [day]: stops } } }
  // One step of undo, alive for as long as the message is — not a history.
  const [snack, setSnack] = useState(null)
  const dropUndo = () => setSnack((s) => (s?.undo ? null : s))
  // Set while one operation changes several days (an agent reply), so they
  // are collected into a single undo instead of each replacing the last.
  const undoBatch = useRef(null)
  const deletingTrip = useRef(null)
  const confirm = useConfirm()
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
  // Which family the person holding this device belongs to — as opposed to
  // `activeFamily`, which is whose plan they happen to be looking at. Money
  // is the place the difference matters: "you owe" has to mean you, not
  // whichever family's days are on screen, and not the trip's creator.
  const [myFamily, setMyFamilyId] = useState(null)
  useEffect(() => {
    // A device that already said "I'm family X" for this trip — set once,
    // right after joining via the family picker — opens straight to that
    // family's plan on every later visit, not always back to families[0].
    const saved = trip ? localStorage.getItem(`tripai.myFamily.${trip.id}`) : null
    const stillReal = saved && families.some((f) => f.id === saved)
    const mine = stillReal ? saved : families[0]?.id ?? null
    setActiveFamily(mine)
    setMyFamilyId(mine)
    dropUndo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id])
  const switchFamily = (id) => {
    // Day 1 isn't necessarily this family's day at all — someone joining a
    // multi-family trip partway through would land on a day they were never
    // on, showing an empty plan that looks broken rather than just early.
    setActiveDay(families.find((f) => f.id === id)?.arriveDay ?? 1)
    setActiveFamily(id)
    // The undo belongs to the plan that was on screen; restoring it into a
    // different family's days would overwrite theirs.
    dropUndo()
  }

  /** Remembers "this device is family X" for next time, then switches to it —
   *  used once, right after the join-family picker resolves. Also records on
   *  the trip that this family has someone on board, which is what the share
   *  sheet's "joined / waiting" reads. */
  const setMyFamily = (id) => {
    if (trip) localStorage.setItem(`tripai.myFamily.${trip.id}`, id)
    setMyFamilyId(id)
    switchFamily(id)
    if (trip && !families.find((f) => f.id === id)?.joined) {
      updateList('parties', (list) => list.map((p) => (p.id === id ? { ...p, joined: true } : p)))
    }
  }

  /**
   * A brand new family joining an existing trip — someone who wasn't part
   * of the original "who's traveling" list, entering their own real
   * details rather than having the trip's creator guess on their behalf.
   */
  const addFamily = async ({ name, members, arriveAt, departAt }) => {
    if (!trip) return null
    const id = newId('p')
    const party = {
      id,
      name: name.trim(),
      members: members.map((m) => m.trim()).filter(Boolean).map((m) => ({ name: m, age: '' })),
      color: PARTY_COLORS[(raw.parties?.length ?? 0) % PARTY_COLORS.length],
      arriveAt: arriveAt || null,
      departAt: departAt || null,
      joined: true,
    }
    const ok = await updateList('parties', (list) => [...list.filter((p) => p.id !== id), party])
    return ok || !hasFirebase ? id : null
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
    // Decided once, here — not inside the change, which may run again on a
    // newer copy of the list and must not flip the day back.
    const turnOn = !sharedDaySet.has(day)
    dropUndo()
    return updateList('parties', (list) => list.map((p) => {
      if (p.id !== activeFamily) return p
      const set = new Set(p.sharedDays ?? [])
      if (turnOn) set.add(day)
      else set.delete(day)
      return { ...p, sharedDays: [...set].sort((a, b) => a - b) }
    }))
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

  // The same value as `days`, readable from a function that was created
  // in an earlier render — see addStop.
  const daysRef = useRef(days)
  daysRef.current = days

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
          const joined = await joinTrip(invited, invitedToken())
          if (joined && !cancelled) {
            setRaw(joined)
            setJustJoined(true)
            setLoading(false)
            logActivity(joined.id, { type: 'join', message: t('{name} הצטרף/ה לטיול', { name: user?.name || t('מישהו') }) })
            history.replaceState(null, '', location.pathname)
            return
          }
          // The link did not work — the trip was deleted, or there is no
          // connection. This used to go on to load the invited trip anyway,
          // which failed the same way and left the visitor on the welcome
          // screen with no explanation and their own trip out of reach.
          // Say what happened and carry on with the trip they already had.
          if (!cancelled) {
            setSnack({ text: t('לא הצלחנו להצטרף לטיול מהקישור. ייתכן שהטיול נמחק, או שאין חיבור לאינטרנט.') })
            history.replaceState(null, '', location.pathname)
          }
        }

        const current = profile.currentTripId
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

  // The trip document, live. Expenses, notes, reservations and families
  // travel on it, so without this a second member only ever saw the first
  // one's changes after a reload. Local edits arrive here too (Firestore
  // reports a pending write straight away), so this never undoes one.
  useEffect(() => {
    if (!trip?.id) return
    const id = trip.id
    return watchTrip(
      id,
      (doc) => setRaw((current) => (current?.id === id ? doc : current)),
      () => {
        if (deletingTrip.current === id) return
        // Deleted by its owner on another device, or this account was taken
        // off it. Either way there is nothing here to show any more.
        setRaw((current) => (current?.id === id ? null : current))
        setTrips((list) => list.filter((x) => x.id !== id))
        setSnack({ text: t('הטיול כבר לא זמין — ייתכן שמי שיצר אותו מחק אותו.') })
      }
    )
  }, [trip?.id])

  // A message with nothing to tap goes away on its own; one that offers an
  // undo stays a little longer.
  useEffect(() => {
    if (!snack) return
    const timer = setTimeout(() => setSnack(null), snack.undo ? 9000 : 6000)
    return () => clearTimeout(timer)
  }, [snack])

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

  // Lines the model writes, each on its own, when it wants the itinerary
  // actually changed — see the action list in systemPrompt(). Caught here
  // rather than shown, then executed for real, and the user is told what
  // really happened: the model used to write its own "I've updated it!"
  // whether or not anything ran (or worked), so the chat claimed changes the
  // itinerary never got.
  const ACTION_LINE = /^\s*(PLAN_DAYS|ADD_STOP|REMOVE_STOP|BOOKING_LINK)\s*:\s*(.*)$/i
  // Matches the model's reply in whichever language the UI asked it to use.
  const CLAIM = /(הוספתי|עדכנתי|בניתי|שיניתי|הסרתי|תכננתי מחדש|הכנסתי|מחקתי|\bI(?:'ve| have)? (?:added|updated|rebuilt|changed|removed|replanned|moved|deleted)\b)/i // i18n-ignore

  const runChatActions = async (actions) => {
    const report = []
    // A working copy per day — several actions on the same day in one reply
    // would otherwise each start from the same stale list and overwrite one
    // another.
    const work = {}
    const listFor = (day) => (work[day] ??= [...(daysRef.current[day] ?? [])])
    const inRange = (d) => Number.isInteger(d) && d >= 1 && d <= trip.totalDays

    // Everything this reply changes is collected as one undo step. Without
    // the batch, each day touched would overwrite the previous day's undo
    // and only the last could be taken back.
    undoBatch.current = {}

    for (const { kind, args } of actions) {
      const parts = args.split('|').map((p) => p.trim())

      if (kind === 'PLAN_DAYS') {
        const wanted = [...new Set(parts[0].split(',').map((n) => parseInt(n, 10)).filter(inRange))]
        // Rebuilding throws away what is on those days, so the agent has to
        // ask first. What the model writes is shaped by everything it was
        // shown — web search results, an imported map's descriptions, other
        // members' notes — and none of that should be able to wipe a
        // hand-built day just by containing the right words. Adding a stop
        // is harmless and stays immediate; replacing and removing are not.
        const occupied = wanted.filter((d) => (daysRef.current[d] ?? []).length > 0)
        if (occupied.length > 0) {
          const ok = await confirm({
            title: t('לבנות מחדש את יום {days}?', { days: occupied.join(', ') }),
            body: t('הסוכן מבקש לבנות את היום מחדש. העצירות שכבר נמצאות בו יוחלפו.'),
            action: t('בנה מחדש'),
          })
          if (!ok) {
            report.push(`• ${t('לא נגעתי ביום {days} — הבנייה מחדש בוטלה', { days: occupied.join(', ') })}`)
            continue
          }
        }
        for (const day of wanted) {
          const r = await plan(day, { instructions: parts[1] ?? '' })
          const why = r.warning === 'busy' ? ` — ${t('עדיין באמצע תכנון, נסו שוב עוד רגע')}` : r.warning ? ` — ${r.warning}` : ''
          report.push(r.ok
            ? `✓ ${t('בניתי מחדש את יום {day} ({n} עצירות)', { day, n: r.count })}`
            : `✗ ${t('לא הצלחתי לבנות את יום {day}', { day })}${why}`)
          // The day was replaced wholesale — a stale working copy would undo it.
          delete work[day]
        }
      }

      if (kind === 'ADD_STOP') {
        const [dayStr, time, query, he, category, desc] = parts
        const day = parseInt(dayStr, 10)
        if (!inRange(day) || !query || !he) {
          report.push(`✗ ${t('לא הבנתי איזו עצירה להוסיף')}`)
          continue
        }
        const list = listFor(day)
        if (list.some((s) => (s.he ?? s.name) === he)) {
          report.push(`• ${t('{place} כבר ביום {day}', { place: he, day })}`)
          continue
        }
        const hit = (await geocodeNear(query, trip)) ?? (await geocodeNear(he, trip))
        if (!hit) {
          report.push(`✗ ${t('לא הצלחתי לאתר את "{place}" על המפה — לא הוספתי', { place: he })}`)
          continue
        }
        const next = [...list, {
          id: newId('c'),
          name: (hit.name || query.split(',')[0]).trim(),
          he,
          desc: desc ?? '',
          time: /^\d{1,2}:\d{2}$/.test(time ?? '') ? time.padStart(5, '0') : '12:00',
          cat: normaliseCategory(category),
          rating: null,
          lat: hit.lat,
          lng: hit.lng,
        }].sort((a, b) => String(a.time).localeCompare(String(b.time)))
        work[day] = next
        setDayStops(day, next)
        report.push(`✓ ${t('הוספתי את {place} ליום {day}', { place: he, day })}`)
      }

      if (kind === 'REMOVE_STOP') {
        const [dayStr, name] = parts
        const day = parseInt(dayStr, 10)
        const list = inRange(day) ? listFor(day) : []
        const at = list.findIndex(
          (s) => name && ((s.he ?? '').includes(name) || (s.name ?? '').includes(name) || (s.he && name.includes(s.he)))
        )
        if (at < 0) {
          report.push(`✗ ${t('לא מצאתי "{place}" ביום {day}', { place: name, day: dayStr })}`)
          continue
        }
        const target = list[at].he ?? list[at].name
        const ok = await confirm({
          title: t('להסיר את {place}?', { place: target }),
          body: t('הסוכן מבקש להסיר את העצירה הזו מיום {day}.', { day }),
          action: t('הסר'),
        })
        if (!ok) {
          report.push(`• ${t('{place} נשאר ביום {day}', { place: target, day })}`)
          continue
        }
        const [gone] = list.splice(at, 1)
        setDayStops(day, [...list])
        report.push(`✓ ${t('הסרתי את {place} מיום {day}', { place: gone.he ?? gone.name, day })}`)
      }

      // A real, working link — not a claim of having booked anything. Google
      // Maps' documented URL scheme (no key, no API call, never wrong the way
      // a guessed OpenTable/Resy deep link could be) takes the place name
      // straight to its map listing, which itself surfaces a reservation
      // button when the place actually has one. Doesn't start with "✓" on
      // purpose — nothing in the itinerary changed, so the "see it in the
      // itinerary" line below must not fire for this alone.
      if (kind === 'BOOKING_LINK') {
        const [query, he, category] = parts
        if (!query || !he) {
          report.push(`✗ ${t('לא הבנתי איזה מקום לחפש')}`)
          continue
        }
        const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
        const isFood = /מסעד|restaurant|food/i.test(category ?? '') // i18n-ignore — model output
        report.push(`🔗 ${he} — ${isFood ? t('קישור להזמנת שולחן') : t('קישור להזמנה')} (Google Maps): ${url}`)
      }
    }

    const before = undoBatch.current
    undoBatch.current = null
    if (Object.keys(before).length > 0) {
      setSnack({ text: t('הסוכן שינה את המסלול'), action: t('בטל'), undo: { family: activeFamily, days: before } })
    }
    return report
  }

  // Only the model's prose — never the machine lines around it — may reach
  // the screen while a reply streams in. A line still being written is held
  // back while it could turn out to be one ("A" may yet become ADD_STOP),
  // and a half-written [[place|…]] is cut until it closes.
  const MACHINE = ['PLAN_DAYS', 'ADD_STOP', 'REMOVE_STOP', 'BOOKING_LINK', 'SUGGEST', 'REMEMBER']
  const MACHINE_LINE = /^\s*(SUGGEST|REMEMBER)\s*:/i
  const visibleSoFar = (full) => {
    const lines = full.split('\n')
    const partial = lines.pop() ?? ''
    const shown = lines.filter((l) => !ACTION_LINE.test(l) && !MACHINE_LINE.test(l))
    const head = partial.trimStart().toUpperCase()
    const maybeMachine = head.length > 0 && MACHINE.some((k) =>
      head.includes(':') ? head.split(':')[0].trim() === k : k.startsWith(head)
    )
    if (!maybeMachine) shown.push(partial)
    let text = shown.join('\n').replace(/\*\*/g, '')
    const open = text.lastIndexOf('[[')
    if (open > text.lastIndexOf(']]')) text = text.slice(0, open)
    return text.trim()
  }

  /** Adds what the agent learned (REMEMBER lines) to the trip, skipping
   *  anything it already knows. Returns the facts actually added. */
  const rememberFacts = async (facts) => {
    const known = new Set((trip?.memory ?? []).map((m) => m.text.trim().toLowerCase()))
    const fresh = [...new Set(facts.map((f) => f.trim()).filter(Boolean))]
      .filter((f) => !known.has(f.toLowerCase()))
      .slice(0, 5)
    if (fresh.length === 0) return []
    const now = Date.now()
    const added = fresh.map((text) => ({ id: newId('m'), text, at: now }))
    await updateList('memory', (list) => [...list.filter((m) => !added.some((a) => a.id === m.id)), ...added])
    breadcrumb('action', `agent remembered ${fresh.length} fact(s)`)
    return fresh
  }

  const forgetMemory = (id) => updateList('memory', (list) => list.filter((m) => m.id !== id))

  const askAgent = async (history, { opener = false } = {}) => {
    const controller = new AbortController()
    chatAbort.current = controller
    setChatError(null)
    setChatTyping(true)
    const id = `a${Date.now()}`

    // The opener always gets the weather — "it's going to rain tomorrow" is
    // exactly the kind of thing worth opening with.
    const lastMine = [...history].reverse().find((m) => m.role === 'me')
    const weather = opener || WEATHER_TRIGGER.test(lastMine?.text ?? '')
      ? await fetchTripWeather(trip).catch(() => null)
      : null

    const system = systemPrompt({ trip, stops, days, families, memory: trip.memory, weather })

    try {
      // Streamed onto the screen as it arrives — waiting 6-12 seconds on
      // three dots and then getting the whole answer at once felt like a
      // form being processed, not a conversation. visibleSoFar() keeps the
      // machine lines out of sight; they're acted on once the reply is done.
      let full = ''
      let placed = false
      await streamReply({
        messages: history,
        system,
        searchContext: `${trip.city}, ${trip.country}`,
        signal: controller.signal,
        onChunk: (delta) => {
          full += delta
          const text = visibleSoFar(full)
          if (!text) return
          const first = !placed
          placed = true
          setChatMessages((m) => first
            ? [...m, { id, role: 'ai', text, streaming: true }]
            : m.map((x) => (x.id === id ? { ...x, text } : x)))
        },
      })

      const actions = []
      const text = []
      // Follow-ups the agent offers ("SUGGEST: a | b | c") — shown as tap
      // targets under its reply, never as text.
      let suggestions = []
      const remember = []
      for (const l of full.split('\n')) {
        const m = l.match(ACTION_LINE)
        const s = l.match(/^\s*SUGGEST\s*:\s*(.*)$/i)
        const r = l.match(/^\s*REMEMBER\s*:\s*(.*)$/i)
        if (s) suggestions = s[1].split('|').map((x) => x.trim()).filter(Boolean).slice(0, 3)
        else if (r) remember.push(r[1])
        else if (m && trip) actions.push({ kind: m[1].toUpperCase(), args: m[2] })
        else text.push(l)
      }
      // Markdown asterisks showed up literally in the bubble.
      const say = text.join('\n').replace(/\*\*/g, '').trim()

      const noted = remember.length > 0 ? await rememberFacts(remember) : []
      const note = noted.length > 0 ? `\n\n📌 ${t('שמרתי לזיכרון: {facts}', { facts: noted.join(' · ') })}` : ''

      let finalText
      if (actions.length > 0) {
        breadcrumb('action', `chat actions: ${actions.map((a) => a.kind).join(',')}`)
        const report = await runChatActions(actions)
        const done = report.some((r) => r.startsWith('✓'))
        // The app's own account of what happened — never the model's.
        finalText = report.join('\n') + (done ? `\n\n${t('אפשר לראות את זה במסך "מסלול הטיול".')}` : '')
      } else {
        // A claim of having changed the itinerary with no action behind it is
        // the model talking as if it had done something — say so.
        finalText = CLAIM.test(say)
          ? `${say}\n\n⚠ ${t('לא שיניתי כלום בלו"ז. כדי שאשנה, כתבו למשל "הוסף את זה ליום 1".')}`
          : say
      }
      finalText = (finalText + note).trim()

      setChatMessages((m) => {
        const rest = m.filter((x) => x.id !== id)
        return finalText ? [...rest, { id, role: 'ai', text: finalText, suggestions }] : rest
      })
    } catch (err) {
      if (err?.name === 'AbortError') return
      if (opener) {
        // A failed greeting is not worth an error card — the empty chat with
        // its starter questions is a perfectly good fallback.
        setChatMessages([])
      } else {
        setChatMessages((m) => m.map((x) => (x.id === id ? { ...x, streaming: false } : x)))
        setChatError(err.message)
      }
    } finally {
      setChatTyping(false)
      chatAbort.current = null
    }
  }

  /**
   * The agent speaks first when the chat opens on an empty thread, once per
   * trip per session. The prompt that asks it to is a real user turn in the
   * history (Gemini needs the conversation to start with one) but marked
   * hidden, so it's never drawn.
   */
  const openerFor = useRef(null)
  const openChat = () => {
    if (!hasAI || !trip || chatTyping || chatMessages.length > 0 || openerFor.current === trip.id) return
    openerFor.current = trip.id
    const history = [{ id: `u${Date.now()}`, role: 'me', text: OPENER_PROMPT, hidden: true }]
    setChatMessages(history)
    askAgent(history, { opener: true })
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
    else setChatError(t('הסוכן אינו מחובר כרגע.'))
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
    // Switching it off also wipes the last position — "stopped sharing"
    // should not leave a pin's worth of coordinates sitting in the trip.
    if (!next) updatePresence(trip.id, user?.uid, { active: false, lat: null, lng: null })
  }

  useEffect(() => {
    if (!sharingLocation || !trip || typeof navigator === 'undefined' || !navigator.geolocation) return

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now()
        if (now - lastWriteAt.current < PRESENCE_WRITE_MS) return
        lastWriteAt.current = now
        updatePresence(trip.id, user?.uid, {
          name: user?.name || t('מישהו'),
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
    // Only for your own family. Tapping another family's pill just to look
    // at their plan used to have the agent write one into their days.
    if (activeFamily !== myFamily) return
    const bucket = sharedDaySet.has(trip.day) ? 'shared' : activeFamily
    listRoutes(trip.id, bucket).then((routes) => {
      if (routes.some((r) => r.day === trip.day && r.stops?.length)) return
      plan(trip.day)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, activeFamily, loading])

  const plan = async (day = activeDay, { instructions = '' } = {}) => {
    if (planning || !trip || !activeFamily) return { ok: false, count: 0, warning: 'busy' }
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
      instructions,
      memory: trip.memory,
    })

    if (fresh.length > 0) {
      noteChange(t('יום {day} נבנה מחדש', { day }), { [day]: daysRef.current[day] ?? [] })
      applyLocalDay(day, fresh)
      persist(day, fresh)
    }
    setPlanWarning(warning ?? null)
    setPlanning(false)
    return { ok: fresh.length > 0, count: fresh.length, warning: warning ?? null }
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
    daysRef.current = { ...daysRef.current, [day]: next }
    if (sharedDaySet.has(day)) setSharedRoutes((d) => ({ ...d, [day]: next }))
    else setOwnDays((d) => ({ ...d, [day]: next }))
  }

  /**
   * Records what some days held before a change, so it can be taken back.
   * `before` is { [day]: stops }. Inside a batch (an agent reply touching
   * several days) it is only collected — the first snapshot of each day
   * wins, since that is the state to go back to. Otherwise it becomes the
   * message at the bottom of the screen, with its undo. Nothing is offered
   * when there was nothing there to lose.
   */
  const noteChange = (text, before) => {
    if (undoBatch.current) {
      for (const [day, list] of Object.entries(before)) undoBatch.current[day] ??= list
      return
    }
    if (!Object.values(before).some((list) => list.length > 0)) return
    setSnack({ text, action: t('בטל'), undo: { family: activeFamily, days: before } })
  }

  /** Puts back the days the current message remembers. */
  const runSnackAction = () => {
    const undo = snack?.undo
    setSnack(null)
    if (!undo || undo.family !== activeFamily) return
    breadcrumb('action', 'undo itinerary change')
    for (const [day, list] of Object.entries(undo.days)) {
      applyLocalDay(Number(day), list)
      persist(Number(day), list)
    }
  }

  // `undoable` is the message to show with an undo for this change. A change
  // made without one (adding, reordering) drops any undo still on offer:
  // going back to the older snapshot now would silently discard it.
  const setDayStops = (day, next, undoable) => {
    if (undoBatch.current) undoBatch.current[day] ??= daysRef.current[day] ?? []
    else if (undoable) noteChange(undoable, { [day]: daysRef.current[day] ?? [] })
    else dropUndo()
    applyLocalDay(day, next)
    persist(day, next)
  }

  const moveStop = (day, id, delta) => {
    const list = [...(daysRef.current[day] ?? [])]
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
  const whoami = () => user?.name || t('מישהו בטיול')

  // Reads the list through daysRef, not the `days` of the render this
  // function was created in. Screens call it after an await (a geocode, an
  // AI suggestion); by then that `days` could be seconds old, and writing
  // "old list + new stop" threw away whatever was added in between — tap two
  // suggestions quickly and only one survived.
  const addStop = (day, stop) => {
    const list = daysRef.current[day] ?? []
    if (list.some((s) => s.name === stop.name)) return
    const next = [...list, { ...stop, id: newId('s') }].sort((a, b) =>
      String(a.time).localeCompare(String(b.time))
    )
    breadcrumb('action', `add stop to day ${day}`)
    setDayStops(day, next)
    if (trip) {
      logActivity(trip.id, { type: 'stop', message: t('{name} הוסיף/ה עצירה ליום {day}: {place}', { name: whoami(), day, place: stop.he ?? stop.name }) })
    }
  }

  const removeStop = (day, id) => {
    const list = daysRef.current[day] ?? []
    const removed = list.find((s) => s.id === id)
    setDayStops(
      day,
      list.filter((s) => s.id !== id),
      removed ? t('{place} הוסר/ה מיום {day}', { place: removed.he ?? removed.name, day }) : undefined
    )
    if (trip && removed) {
      logActivity(trip.id, { type: 'stop', message: t('{name} הסיר/ה עצירה מיום {day}: {place}', { name: whoami(), day, place: removed.he ?? removed.name }) })
    }
  }

  /** Patches one stop in place — used to give a stop added without a map
   *  position its coordinates once a retry finds the place. */
  const updateStop = (day, id, patch) => {
    setDayStops(day, (daysRef.current[day] ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  /** Moves one stop to another day, keeping both days in time order. */
  const moveStopToDay = (fromDay, id, toDay) => {
    if (fromDay === toDay) return
    const source = daysRef.current[fromDay] ?? []
    const destination = daysRef.current[toDay] ?? []
    const stop = source.find((s) => s.id === id)
    if (!stop) return

    const remaining = source.filter((s) => s.id !== id)
    const target = [...destination, stop].sort((a, b) =>
      String(a.time).localeCompare(String(b.time))
    )

    breadcrumb('action', `move stop ${fromDay} -> ${toDay}`)
    noteChange(
      t('{place} הועבר/ה ליום {day}', { place: stop.he ?? stop.name, day: toDay }),
      { [fromDay]: source, [toDay]: destination }
    )
    applyLocalDay(fromDay, remaining)
    applyLocalDay(toDay, target)
    persist(fromDay, remaining)
    persist(toDay, target)
  }

  /* ---- reservations ----
   * Used to live only in this component's own useState — a real booking
   * (and, once one exists, a photo of the actual ticket attached to it)
   * that vanished the moment the tab closed, same class of bug notes and
   * expenses already had fixed by living on the trip document instead. */

  const reservations = trip?.reservations ?? []

  const addReservation = (r) => {
    if (!trip) return null
    const entry = { ...r, id: newId('r'), createdAt: Date.now() }
    updateList('reservations', (list) => [entry, ...list.filter((x) => x.id !== entry.id)])
    breadcrumb('action', `reservation noted: ${r.place}`)
    return entry
  }

  const removeReservation = (id) => {
    if (!trip) return
    deleteTicketPhoto(trip.id, id) // best-effort — an orphaned file costs nothing to leave, but no reason to
    return updateList('reservations', (list) => list.filter((r) => r.id !== id))
  }

  /* ---- trip lifecycle ---- */

  const completeOnboarding = async ({ imported, ...answers }) => {
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

    // Dates picked shorter than the imported plan would hide its last days
    // off the end of the trip — stretch the return date to fit them.
    if (imported?.days?.length && located.from) {
      const minTo = new Date(`${located.from}T00:00:00Z`)
      minTo.setUTCDate(minTo.getUTCDate() + importSpan(imported) - 1)
      const iso = minTo.toISOString().slice(0, 10)
      if (!located.to || located.to < iso) located = { ...located, to: iso }
    }

    const { id, code } = await createTrip(located)

    // A trip imported from Google Maps arrives with its days already
    // planned. Saved before the trip is set as current, so the "nothing
    // stored for today — generate it" effect finds them and leaves them be.
    if (imported?.days?.length) {
      const byDay = await importedStops(imported)
      const bucket = located.parties?.[0]?.id
      await Promise.all(
        Object.entries(byDay).map(([day, list]) =>
          saveRoute(id, bucket, { day: Number(day), city: located.destination, stops: list })
        )
      )
      setOwnDays(Object.fromEntries(Object.entries(byDay).map(([d, list]) => [Number(d), list])))
      breadcrumb('lifecycle', `imported ${Object.keys(byDay).length} days from Google Maps`)
    }

    const ownerId = user?.uid ?? 'local'
    const created = { ...located, id, code, ownerId, memberIds: [ownerId] }
    setRaw(created)
    // Only the [user] effect below refetches this list, so it never changing
    // (this device was already signed in) left a trip created mid-session
    // invisible in "הטיולים שלך" until the next sign-in or reload — even
    // though it saved correctly. Prepending here keeps the list honest
    // without a second round trip to fetch what was just created locally.
    setTrips((list) => [created, ...list.filter((x) => x.id !== id)])
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
    // The live watch on the trip reports the deletion before this function
    // gets its answer back; without the flag it would announce "deleted by
    // its creator" to the creator.
    deletingTrip.current = tripId
    const ok = await deleteTrip(tripId)
    deletingTrip.current = null
    // A `false` here means either "no backend, deleted locally as intended"
    // or "the write was actually rejected" (a non-owner member, most
    // realistically — firebase.rules restricts delete to the owner, which
    // the account sheet was not checking before showing this button at
    // all). Only the second one is a failure; treating both the same would
    // have the trip vanish from this device's list while it is still very
    // much there for everyone else, then reappear next time it reloads.
    if (!ok && hasFirebase) return { ok: false }

    setTrips((list) => list.filter((x) => x.id !== tripId))

    if (trip?.id === tripId) {
      const next = trips.find((x) => x.id !== tripId)
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
   * Changes one of the trip's lists — expenses, notes, reservations, stays,
   * parties, memory. `change` takes the list and returns the new one; it is
   * applied here to the copy on screen (so the edit shows at once) and then
   * to the server's current copy (see mutateTripList in db.js), which is why
   * it must not depend on anything but the list it is given.
   */
  const updateList = async (field, change) => {
    if (!trip) return false
    setRaw((r) => (r ? { ...r, [field]: change(r[field] ?? []) } : r))
    setSyncing(true)
    const ok = await mutateTripList(trip.id, field, change)
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
    logActivity(trip.id, { type: 'note', message: t('{name} הוסיף/ה הערה: {note}', { name: whoami(), note: trimmed }) })
    const note = { id: newId('n'), text: trimmed }
    return updateList('notes', (list) => [...list.filter((n) => n.id !== note.id), note])
  }

  const updateNote = (id, text) => {
    const trimmed = text.trim()
    if (!trimmed || !trip) return
    return updateList('notes', (list) => list.map((n) => (n.id === id ? { ...n, text: trimmed } : n)))
  }

  const removeNote = (id) => {
    if (!trip) return
    return updateList('notes', (list) => list.filter((n) => n.id !== id))
  }

  /**
   * Shared expenses, for the split-the-bill screen. These used to live only
   * in that screen's own useState — real spending that vanished the moment
   * the tab closed or the app was reopened, with nothing to say it hadn't
   * saved.
   */
  const addExpense = (expense) => {
    if (!trip) return
    return updateList('expenses', (list) => [expense, ...list.filter((e) => e.id !== expense.id)])
  }

  const updateExpense = (id, patch) => {
    if (!trip) return
    return updateList('expenses', (list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  const removeExpense = (id) => {
    if (!trip) return
    return updateList('expenses', (list) => list.filter((e) => e.id !== id))
  }

  /**
   * Places to sleep. More than one is normal — a trip that moves between
   * cities, or a family that splits up for part of it — so each stay carries
   * its own optional date range rather than the trip having one hotel.
   */
  const addStay = (stay) => {
    if (!trip || trip.stays.some((s) => s.label === stay.label)) return
    return updateList('stays', (list) => [...list.filter((s) => s.label !== stay.label), stay])
  }

  const updateStay = (label, patch) => {
    if (!trip) return
    return updateList('stays', (list) => list.map((s) => (s.label === label ? { ...s, ...patch } : s)))
  }

  const removeStay = (label) => {
    if (!trip) return
    return updateList('stays', (list) => list.filter((s) => s.label !== label))
  }

  const value = {
    user, trip, trips, loading, syncState, skipWelcome,
    stops, days, activeDay, setActiveDay, activeFamily, switchFamily, myFamily,
    sharedDaySet, toggleSharedDay, setMyFamily, addFamily,
    snack, runSnackAction, dismissSnack: () => setSnack(null),
    families, isReal, planning, planWarning,
    plan, moveStop, addStop, removeStop, updateStop, moveStopToDay,
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
    sendChatMessage, retryChatMessage, openChat, forgetMemory,
  }

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>
}
