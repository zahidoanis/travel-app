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

function localRemove(key) {
  try {
    localStorage.removeItem(LOCAL_PREFIX + key)
  } catch {
    /* quota or private mode */
  }
}

/**
 * Firestore's setDoc() rejects an `undefined` field value outright, and
 * rejects synchronously — before any network call, so nothing else in the
 * same write goes through either. A trip made before some field existed
 * (lat/lng, at one point) leaves that key genuinely undefined on the stored
 * document, and any edit that round-trips it back through a save fails the
 * whole write. Recursive because the value can be buried arbitrary levels
 * deep — a null coordinate inside a stay inside an array, for instance —
 * not just a bare top-level key.
 */
function stripUndefined(value) {
  // Filtered, not mapped — Firestore rejects undefined as an array element
  // exactly as it does an object field, and mapping would have kept a hole
  // in place instead of removing it.
  if (Array.isArray(value)) return value.filter((v) => v !== undefined).map(stripUndefined)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefined(v)
    }
    return out
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
        ...stripUndefined(details),
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
      // Stripped before adding the server-timestamp sentinel, not after —
      // recursing into that sentinel object would tear out the internal
      // fields that make it a FieldValue rather than a plain object.
      await FS.setDoc(
        FS.doc(db, 'trips', tripId),
        { ...stripUndefined(patch), updatedAt: FS.serverTimestamp() },
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

/**
 * Deletes a trip outright. firebase.rules restricts this to the owner —
 * one member cannot erase it for everyone else — so a non-owner's call
 * fails there, not here.
 */
export function deleteTrip(tripId) {
  breadcrumb('data', `deleteTrip ${tripId}`)

  return guarded(
    'deleteTrip',
    async ({ db, FS }) => {
      // Firestore does not cascade-delete subcollections when the parent
      // document goes — the day documents underneath would just sit there
      // orphaned, readable to nobody, forever. Best-effort cleanup first.
      const routesSnap = await FS.getDocs(FS.collection(db, 'trips', tripId, 'routes'))
      await Promise.all(routesSnap.docs.map((d) => FS.deleteDoc(d.ref)))
      await FS.deleteDoc(FS.doc(db, 'trips', tripId))
      return true
    },
    () => {
      localRemove(`trip.${tripId}`)
      localRemove(`routes.${tripId}`)
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

/**
 * Moves a trip's ownership onto the account that just merged into it.
 *
 * Only called right after `joinTrip` in the one case where signing in with
 * Google lands on a *different*, pre-existing account instead of linking the
 * anonymous one in place (see signInWithGoogle's `merged` result) — and only
 * for a trip this device itself created before signing in. Deletion is
 * owner-only, so without this the person who made the trip would keep it,
 * see it, edit it, but permanently lose the ability to delete it the moment
 * they signed into their real account, which is the opposite of what
 * "save this trip" promised. Must run after joinTrip, not combined with it:
 * the rule that lets a non-member add themselves only allows touching
 * `members`/`memberIds`, not `ownerId` — this write needs the caller to
 * already be a member.
 */
export function claimOwnership(tripId) {
  breadcrumb('data', `claimOwnership ${tripId}`)

  return guarded(
    'claimOwnership',
    async ({ db, uid, FS }) => {
      const ref = FS.doc(db, 'trips', tripId)
      await FS.updateDoc(ref, {
        ownerId: uid,
        [`members.${uid}`]: 'owner',
        updatedAt: FS.serverTimestamp(),
      })
      return true
    },
    () => false
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
  let retried = false

  firebase().then((fb) => {
    if (!fb || cancelled) return
    const { db, FS } = fb

    const subscribe = () => {
      stop = FS.onSnapshot(
        FS.query(FS.collection(db, 'trips', tripId, 'routes'), FS.orderBy('day', 'asc')),
        (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => {
          // A permission-denied right after signing in is not necessarily
          // real — linking or merging a Google account swaps the active uid
          // essentially the moment it resolves, while adding that uid to
          // the trip's memberIds is a separate write that can still be in
          // flight. Firestore re-checks this listener's rule against the
          // new uid immediately and denies it in that gap, then closes the
          // subscription — it does not retry on its own. One retry after a
          // beat covers that window without looping forever on someone who
          // has genuinely lost access.
          if (err.code === 'permission-denied' && !retried && !cancelled) {
            retried = true
            setTimeout(() => { if (!cancelled) subscribe() }, 1500)
            return
          }
          record({ kind: 'db', message: `watchRoutes: ${err.message}`, stack: err.stack })
        }
      )
    }

    subscribe()
  })

  return () => {
    cancelled = true
    stop()
  }
}

/* ------------------------------------------------------------------ *
 * activity — what the bell shows. Not a general log; only things another
 * member of the trip would actually want to know happened.
 * ------------------------------------------------------------------ */

/** Records one line for the trip's activity feed. Fire-and-forget: a missed
 *  notification is not worth failing the action that triggered it over. */
export function logActivity(tripId, { type, message }) {
  if (!tripId) return
  return guarded(
    'logActivity',
    async ({ db, FS }) => {
      await FS.addDoc(FS.collection(db, 'trips', tripId, 'activity'), {
        type,
        message,
        createdAt: FS.serverTimestamp(),
      })
      return true
    },
    () => false
  )
}

/** Live feed, newest first, capped — this is a bell, not an archive. */
export function watchActivity(tripId, onChange) {
  if (!hasFirebase || !tripId) {
    onChange([])
    return () => {}
  }

  let stop = () => {}
  let cancelled = false

  firebase().then((fb) => {
    if (!fb || cancelled) return
    const { db, FS } = fb
    stop = FS.onSnapshot(
      FS.query(
        FS.collection(db, 'trips', tripId, 'activity'),
        FS.orderBy('createdAt', 'desc'),
        FS.limit(30)
      ),
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => record({ kind: 'db', message: `watchActivity: ${err.message}`, stack: err.stack })
    )
  })

  return () => {
    cancelled = true
    stop()
  }
}

/* ------------------------------------------------------------------ *
 * presence — live location, opt-in, one document per member who has it on.
 * ------------------------------------------------------------------ */

/** Upserts one member's live position. Merge, not overwrite — a stale field
 *  from a slow prior write should never wipe a fresher one that landed
 *  first from the same device's next tick. */
export function updatePresence(tripId, uid, data) {
  if (!tripId || !uid) return
  return guarded(
    'updatePresence',
    async ({ db, FS }) => {
      await FS.setDoc(
        FS.doc(db, 'trips', tripId, 'presence', uid),
        { ...data, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return true
    },
    () => false
  )
}

/** Every member currently sharing, or who has at some point — a stale
 *  `updatedAt` is how the UI tells "closed the app without switching this
 *  off" apart from "still here," since there is no way to run code when a
 *  tab closes to clean the document up itself. */
export function watchPresence(tripId, onChange) {
  if (!hasFirebase || !tripId) {
    onChange([])
    return () => {}
  }

  let stop = () => {}
  let cancelled = false

  firebase().then((fb) => {
    if (!fb || cancelled) return
    const { db, FS } = fb
    stop = FS.onSnapshot(
      FS.collection(db, 'trips', tripId, 'presence'),
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => record({ kind: 'db', message: `watchPresence: ${err.message}`, stack: err.stack })
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
