/**
 * Data layer: profile, trips, routes, and the crash log sink.
 *
 * Every function degrades to localStorage when Firebase isn't configured, so
 * the app behaves identically before and after you connect a project — you
 * just lose cross-device sync. That also means the UI never needs to branch on
 * "is Firebase set up", and it keeps working if the network drops.
 *
 * Firestore layout
 * ----------------
 *   users/{uid}                          profile: name, home currency, prefs
 *   users/{uid}/trips/{tripId}           city, dates, status, cover
 *   users/{uid}/trips/{tripId}/routes/{routeId}
 *                                        one day's ordered stops
 *   diagnostics/{uid}/events/{eventId}   crash + error log
 *
 * Rules in firestore.rules scope every path to the signed-in uid.
 */

import { firebase, hasFirebase } from './firebase'
import { record, breadcrumb, watchdog } from './telemetry'

const LOCAL_PREFIX = 'tripai.local.'

/* ------------------------------------------------------------------ *
 * local fallback
 * ------------------------------------------------------------------ */

function localGet(key, fallback) {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function localSet(key, value) {
  try {
    localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(value))
  } catch {
    /* quota or private mode */
  }
  return value
}

/** Wraps a Firestore call so a failure degrades instead of throwing upward. */
async function guarded(name, fn, fallback) {
  const fb = await firebase()
  if (!fb) return fallback()

  const done = watchdog(`db.${name}`, 12000)
  try {
    return await fn(fb)
  } catch (err) {
    record({
      kind: 'db',
      message: `פעולת ${name} נכשלה: ${err?.message ?? err}`,
      stack: err?.stack,
      context: { operation: name, code: err?.code ?? null },
    })
    return fallback()
  } finally {
    done()
  }
}

/* ------------------------------------------------------------------ *
 * profile
 * ------------------------------------------------------------------ */

export const DEFAULT_PROFILE = {
  name: '',
  homeCurrency: 'ILS',
  styles: [],
  budget: 'mid',
  createdAt: null,
}

export function loadProfile() {
  return guarded(
    'loadProfile',
    async ({ db, uid, FS }) => {
      const ref = FS.doc(db, 'users', uid)
      const snap = await FS.getDoc(ref)
      if (!snap.exists()) {
        const fresh = { ...DEFAULT_PROFILE, createdAt: FS.serverTimestamp() }
        await FS.setDoc(ref, fresh)
        return { ...DEFAULT_PROFILE, uid }
      }
      return { ...DEFAULT_PROFILE, ...snap.data(), uid }
    },
    () => ({ ...DEFAULT_PROFILE, ...localGet('profile', {}), uid: 'local' })
  )
}

export function saveProfile(patch) {
  breadcrumb('data', 'saveProfile')
  return guarded(
    'saveProfile',
    async ({ db, uid, FS }) => {
      // merge:true so a partial update never wipes fields set elsewhere.
      await FS.setDoc(
        FS.doc(db, 'users', uid),
        { ...patch, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return true
    },
    () => {
      localSet('profile', { ...localGet('profile', {}), ...patch })
      return false
    }
  )
}

/* ------------------------------------------------------------------ *
 * trips
 * ------------------------------------------------------------------ */

export function listTrips() {
  return guarded(
    'listTrips',
    async ({ db, uid, FS }) => {
      const q = FS.query(
        FS.collection(db, 'users', uid, 'trips'),
        FS.orderBy('startDate', 'desc'),
        FS.limit(50)
      )
      const snap = await FS.getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
    () => localGet('trips', [])
  )
}

export function saveTrip(trip) {
  breadcrumb('data', `saveTrip ${trip.id ?? 'new'}`)
  return guarded(
    'saveTrip',
    async ({ db, uid, FS }) => {
      const id = trip.id ?? FS.doc(FS.collection(db, 'users', uid, 'trips')).id
      await FS.setDoc(
        FS.doc(db, 'users', uid, 'trips', id),
        { ...trip, id, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return id
    },
    () => {
      const id = trip.id ?? `t${Date.now()}`
      const all = localGet('trips', []).filter((t) => t.id !== id)
      localSet('trips', [{ ...trip, id, updatedAt: Date.now() }, ...all])
      return id
    }
  )
}

export function deleteTrip(tripId) {
  breadcrumb('data', `deleteTrip ${tripId}`)
  return guarded(
    'deleteTrip',
    async ({ db, uid, FS }) => {
      await FS.deleteDoc(FS.doc(db, 'users', uid, 'trips', tripId))
      return true
    },
    () => {
      localSet('trips', localGet('trips', []).filter((t) => t.id !== tripId))
      return false
    }
  )
}

/* ------------------------------------------------------------------ *
 * routes — one document per day of a trip
 * ------------------------------------------------------------------ */

export function listRoutes(tripId) {
  return guarded(
    'listRoutes',
    async ({ db, uid, FS }) => {
      const q = FS.query(
        FS.collection(db, 'users', uid, 'trips', tripId, 'routes'),
        FS.orderBy('day', 'asc')
      )
      const snap = await FS.getDocs(q)
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
    () => localGet(`routes.${tripId}`, [])
  )
}

export function saveRoute(tripId, route) {
  breadcrumb('data', `saveRoute ${tripId}/${route.day}`)
  return guarded(
    'saveRoute',
    async ({ db, uid, FS }) => {
      const id = route.id ?? `day-${route.day}`
      await FS.setDoc(
        FS.doc(db, 'users', uid, 'trips', tripId, 'routes', id),
        { ...route, id, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return id
    },
    () => {
      const id = route.id ?? `day-${route.day}`
      const all = localGet(`routes.${tripId}`, []).filter((r) => r.id !== id)
      localSet(`routes.${tripId}`, [...all, { ...route, id }].sort((a, b) => a.day - b.day))
      return id
    }
  )
}

/**
 * Live updates for a trip's routes. Returns an unsubscribe function.
 * Without Firebase it fires once with the local copy and then does nothing —
 * same contract, no realtime.
 */
export function watchRoutes(tripId, onChange) {
  if (!hasFirebase) {
    onChange(localGet(`routes.${tripId}`, []))
    return () => {}
  }

  let stop = () => {}
  let cancelled = false

  firebase().then((fb) => {
    if (!fb || cancelled) return
    const { db, uid, FS } = fb
    stop = FS.onSnapshot(
      FS.query(
        FS.collection(db, 'users', uid, 'trips', tripId, 'routes'),
        FS.orderBy('day', 'asc')
      ),
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => record({ kind: 'db', message: `watchRoutes: ${err.message}`, stack: err.stack })
    )
  })

  return () => {
    cancelled = true
    stop()
  }
}

/* ------------------------------------------------------------------ *
 * diagnostics sink
 * ------------------------------------------------------------------ */

/**
 * Mirrors crash-log entries to Firestore. Wired up by App on startup.
 *
 * Deliberately a separate top-level collection: if the user's own documents
 * are what's broken, the error log must still be writable.
 */
export async function pushDiagnostics(batch) {
  const fb = await firebase()
  if (!fb) throw new Error('firebase unavailable')

  const { db, uid, FS } = fb
  const writer = FS.writeBatch(db)

  for (const entry of batch) {
    const ref = FS.doc(FS.collection(db, 'diagnostics', uid, 'events'))
    writer.set(ref, { ...entry, uid, receivedAt: FS.serverTimestamp() })
  }

  await writer.commit()
  return batch.length
}
