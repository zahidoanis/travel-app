/**
 * Data layer.
 *
 * Trips are **not** owned by a user. They live at `trips/{tripId}` with a
 * member list, because a trip is a shared thing by nature — the same document
 * has to serve your laptop, your phone, and everyone you invited over
 * WhatsApp. Storing it under `users/{uid}` made those three cases into three
 * different problems; this makes them one.
 *
 *   users/{uid}                    profile + a pointer to the current trip
 *   trips/{tripId}                 the trip, with memberIds[]
 *   trips/{tripId}/routes/{day}    one document per day
 *   diagnostics/{uid}/events/{id}  crash log
 *
 * `memberIds` is an array alongside the `members` map because Firestore can
 * query array membership but cannot query map keys.
 *
 * Rules in firebase.rules gate every trip path on that array. Everything here
 * degrades to localStorage when Firebase isn't configured, so the UI never
 * branches on whether a backend exists.
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
 * profile — small now: who you are and which trip you are looking at
 * ------------------------------------------------------------------ */

export function loadProfile() {
  return guarded(
    'loadProfile',
    async ({ db, uid, FS }) => {
      const snap = await FS.getDoc(FS.doc(db, 'users', uid))
      return { ...(snap.exists() ? snap.data() : {}), uid }
    },
    () => ({ ...localGet('profile', {}), uid: 'local' })
  )
}

export function saveProfile(patch) {
  return guarded(
    'saveProfile',
    async ({ db, uid, FS }) => {
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

/** Short, human-speakable, and unguessable enough to act as the invite key. */
function joinCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I/L/O/0/1
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (i === 3) out += '-'
  }
  return out
}

export function createTrip(details) {
  breadcrumb('data', `createTrip ${details.destination}`)

  return guarded(
    'createTrip',
    async ({ db, uid, FS }) => {
      const ref = FS.doc(FS.collection(db, 'trips'))
      const code = joinCode()

      await FS.setDoc(ref, {
        ...details,
        id: ref.id,
        code,
        ownerId: uid,
        members: { [uid]: 'owner' },
        memberIds: [uid],
        createdAt: FS.serverTimestamp(),
        updatedAt: FS.serverTimestamp(),
      })

      await saveProfile({ currentTripId: ref.id })
      return { id: ref.id, code }
    },
    () => {
      const id = `local-${Date.now().toString(36)}`
      const code = joinCode()
      localSet(`trip.${id}`, { ...details, id, code, memberIds: ['local'] })
      localSet('profile', { ...localGet('profile', {}), currentTripId: id })
      return { id, code }
    }
  )
}

export function loadTrip(tripId) {
  if (!tripId) return Promise.resolve(null)

  return guarded(
    'loadTrip',
    async ({ db, FS }) => {
      const snap = await FS.getDoc(FS.doc(db, 'trips', tripId))
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    },
    () => localGet(`trip.${tripId}`, null)
  )
}

export function saveTrip(tripId, patch) {
  return guarded(
    'saveTrip',
    async ({ db, FS }) => {
      await FS.setDoc(
        FS.doc(db, 'trips', tripId),
        { ...patch, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return true
    },
    () => {
      localSet(`trip.${tripId}`, { ...localGet(`trip.${tripId}`, {}), ...patch })
      return false
    }
  )
}

/** Every trip this account belongs to, newest first. */
export function listTrips() {
  return guarded(
    'listTrips',
    async ({ db, uid, FS }) => {
      const snap = await FS.getDocs(
        FS.query(
          FS.collection(db, 'trips'),
          FS.where('memberIds', 'array-contains', uid),
          FS.limit(30)
        )
      )
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
    },
    () => {
      const current = localGet('profile', {}).currentTripId
      const one = current ? localGet(`trip.${current}`, null) : null
      return one ? [one] : []
    }
  )
}

/**
 * Adds this account to an existing trip.
 *
 * The trip id is the secret — it travels in the WhatsApp link — so the rules
 * let anyone holding it add themselves, and nothing else. That is the same
 * security model as an unguessable share link, which is what it is.
 */
export function joinTrip(tripId) {
  breadcrumb('data', `joinTrip ${tripId}`)

  return guarded(
    'joinTrip',
    async ({ db, uid, FS }) => {
      const ref = FS.doc(db, 'trips', tripId)

      await FS.updateDoc(ref, {
        [`members.${uid}`]: 'editor',
        memberIds: FS.arrayUnion(uid),
      })

      await saveProfile({ currentTripId: tripId })
      const snap = await FS.getDoc(ref)
      return snap.exists() ? { id: snap.id, ...snap.data() } : null
    },
    () => null
  )
}

/* ------------------------------------------------------------------ *
 * routes — one document per day of a trip
 * ------------------------------------------------------------------ */

export function listRoutes(tripId) {
  if (!tripId) return Promise.resolve([])

  return guarded(
    'listRoutes',
    async ({ db, FS }) => {
      const snap = await FS.getDocs(
        FS.query(FS.collection(db, 'trips', tripId, 'routes'), FS.orderBy('day', 'asc'))
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
    () => localGet(`routes.${tripId}`, [])
  )
}

export function saveRoute(tripId, route) {
  if (!tripId) return Promise.resolve(false)

  return guarded(
    'saveRoute',
    async ({ db, FS }) => {
      const id = route.id ?? `day-${route.day}`
      await FS.setDoc(
        FS.doc(db, 'trips', tripId, 'routes', id),
        { ...route, id, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return true
    },
    () => {
      const id = route.id ?? `day-${route.day}`
      const all = localGet(`routes.${tripId}`, []).filter((r) => r.id !== id)
      localSet(`routes.${tripId}`, [...all, { ...route, id }].sort((a, b) => a.day - b.day))
      return false
    }
  )
}

/**
 * Live updates for a trip's routes — this is what makes a shared trip feel
 * shared: a stop someone else adds appears without a refresh.
 * Returns an unsubscribe function.
 */
export function watchRoutes(tripId, onChange) {
  if (!hasFirebase || !tripId) {
    onChange(localGet(`routes.${tripId}`, []))
    return () => {}
  }

  let stop = () => {}
  let cancelled = false

  firebase().then((fb) => {
    if (!fb || cancelled) return
    const { db, FS } = fb
    stop = FS.onSnapshot(
      FS.query(FS.collection(db, 'trips', tripId, 'routes'), FS.orderBy('day', 'asc')),
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
 * Mirrors crash-log entries to Firestore.
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
