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
import { DIAGNOSTICS_RETENTION_DAYS } from '../legal/operator'

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

/** Removes every local key starting with `prefix`. */
function localRemovePrefix(prefix) {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(LOCAL_PREFIX + prefix)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
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
      message: `פעולת ${name} נכשלה: ${err?.message ?? err}`, // i18n-ignore — internal log
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
 * Changes one of the lists on the trip document — expenses, notes,
 * reservations, stays, parties, the agent's memory — without losing what
 * someone else just added to it.
 *
 * These lists used to be saved by writing the whole array back from whatever
 * copy this device happened to hold. Two people each adding an expense meant
 * the second write replaced the list with one that had never seen the first:
 * one expense silently gone. Here `change` is applied to the server's
 * current list inside a transaction, so it always builds on the latest
 * version. It can run more than once (a transaction retries when the
 * document moved underneath it), so it has to be a pure function of the list
 * it is handed.
 *
 * Offline there is no server to transact with. The change is then applied to
 * the cached copy and queued as an ordinary write — the old behaviour, which
 * is the best available without a connection.
 */
export function mutateTripList(tripId, field, change) {
  return guarded(
    'mutateTripList',
    async ({ db, FS }) => {
      const ref = FS.doc(db, 'trips', tripId)
      try {
        await FS.runTransaction(db, async (tx) => {
          const snap = await tx.get(ref)
          if (!snap.exists()) throw new Error('trip not found')
          tx.update(ref, {
            [field]: stripUndefined(change(snap.data()[field] ?? [])),
            updatedAt: FS.serverTimestamp(),
          })
        })
      } catch (err) {
        if (err?.code !== 'unavailable') throw err
        const cached = await FS.getDocFromCache(ref)
        // Not awaited: offline, this promise only settles once the write
        // reaches the server, which may be hours away.
        FS.updateDoc(ref, {
          [field]: stripUndefined(change(cached.data()?.[field] ?? [])),
          updatedAt: FS.serverTimestamp(),
        }).catch((e) => record({ kind: 'db', message: `queued ${field} write failed: ${e?.message ?? e}` }))
      }
      return true
    },
    () => {
      const trip = localGet(`trip.${tripId}`, {})
      localSet(`trip.${tripId}`, { ...trip, [field]: change(trip[field] ?? []) })
      return false
    }
  )
}

/**
 * Live copy of the trip document itself.
 *
 * Only the day plans used to be live; the trip — with its expenses, notes,
 * reservations and families — was read once when the app opened. A second
 * member never saw the first one's expense until they reloaded, and the
 * share sheet's "updates appear for everyone" was true of the itinerary
 * alone.
 *
 * `onLost()` means this account can no longer read the trip. That is also
 * how a deletion arrives: the rules check membership on the document, and a
 * document that no longer exists has no members, so the listener is refused
 * rather than told the trip is gone.
 */
export function watchTrip(tripId, onChange, onLost) {
  if (!hasFirebase || !tripId) return () => {}

  let stop = () => {}
  let cancelled = false
  let retried = false

  firebase().then((fb) => {
    if (!fb || cancelled) return
    const { db, FS } = fb

    const subscribe = () => {
      stop = FS.onSnapshot(
        FS.doc(db, 'trips', tripId),
        (snap) => {
          // Only the server's word resets the retry. A resubscription first
          // replays the offline cache — the trip as it was — and counting
          // that as success made a deleted trip loop forever between the
          // cached copy and the refusal, never reaching onLost.
          if (!snap.metadata.fromCache) retried = false
          if (snap.exists()) onChange({ id: snap.id, ...snap.data() })
          else if (!snap.metadata.fromCache) onLost?.()
        },
        (err) => {
          if (err.code !== 'permission-denied' || cancelled) {
            record({ kind: 'db', message: `watchTrip: ${err.message}`, stack: err.stack })
            return
          }
          // Same sign-in race watchRoutes() describes: one retry covers the
          // moment between a new uid taking over and it joining the trip.
          if (!retried) {
            retried = true
            setTimeout(() => { if (!cancelled) subscribe() }, 1500)
            return
          }
          // Refused twice. Ask once more, plainly, before telling anyone the
          // trip is gone — a slow sign-in should not look like a deletion.
          setTimeout(() => {
            if (cancelled) return
            FS.getDoc(FS.doc(db, 'trips', tripId)).then(
              (snap) => (snap.exists() ? subscribe() : onLost?.()),
              (e) => (e?.code === 'permission-denied' ? onLost?.() : subscribe())
            )
          }, 3000)
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

/**
 * Deletes a trip outright. firebase.rules restricts this to the owner —
 * one member cannot erase it for everyone else — so a non-owner's call
 * fails there, not here.
 */
export function deleteTrip(tripId) {
  breadcrumb('data', `deleteTrip ${tripId}`)

  return guarded(
    'deleteTrip',
    async ({ db, uid, FS }) => {
      const snap = await FS.getDoc(FS.doc(db, 'trips', tripId))
      const data = snap.exists() ? snap.data() : {}
      // Checked here as well as in the rules: the rules only stop the trip
      // document itself from going, and by then a non-owner's call would
      // already have emptied everything underneath it.
      if (snap.exists() && data.ownerId !== uid) throw new Error('only the owner can delete a trip')
      await purgeTrip(db, FS, tripId, data)
      return true
    },
    () => {
      // Routes and ticket photos are keyed under the trip id too.
      localRemovePrefix(`trip.${tripId}`)
      localRemovePrefix(`routes.${tripId}`)
      localRemovePrefix(`ticket.${tripId}.`)
      return false
    }
  )
}

/**
 * Removes a trip and everything stored underneath it.
 *
 * Firestore does not cascade-delete subcollections when the parent document
 * goes — whatever is underneath just sits there orphaned, readable to nobody,
 * forever. That used to be true of everything except a `routes` collection
 * the app no longer writes to: the real day plans (under each family), the
 * ticket photos, the activity feed and every member's last shared location
 * all outlived the trip they belonged to. A boarding pass that survives
 * "delete permanently" is exactly what the privacy policy says cannot happen.
 *
 * The subcollections go first, while the caller is still a member and the
 * rules still let them be read; the trip document goes last.
 */
async function purgeTrip(db, FS, tripId, data) {
  const paths = [
    ['routes'], // pre-family layout — older trips may still have these
    ['tickets'],
    ['activity'],
    ['presence'],
    // A family is a path segment, not a document, so it cannot be listed —
    // the ids come from the trip's own parties.
    ...(data.parties ?? []).filter((p) => p?.id).map((p) => ['families', p.id, 'routes']),
  ]
  for (const path of paths) {
    const snap = await FS.getDocs(FS.collection(db, 'trips', tripId, ...path))
    await Promise.all(snap.docs.map((d) => FS.deleteDoc(d.ref)))
  }
  await FS.deleteDoc(FS.doc(db, 'trips', tripId))
}

/**
 * Erases what this account has stored: the "delete my account" half that
 * lives in Firestore (the sign-in itself is removed by deleteAuthAccount in
 * firebase.js, afterwards — these writes need it).
 *
 *   - a trip nobody else is on is deleted outright, with everything in it;
 *   - a shared trip stays with the people still on it. This account is
 *     removed from its member list and its last shared location is deleted,
 *     and if it was the owner, ownership passes to another member so the
 *     trip does not end up with nobody able to delete it;
 *   - the profile document is deleted.
 *
 * Crash-log entries are not touched: the rules make that collection
 * write-only from the browser. They expire on their own (see
 * pushDiagnostics) and the privacy policy says so.
 *
 * Resolves true when everything went through. False means either there is
 * no backend (the caller clears the device either way) or a write failed
 * part-way — it is safe to run again, each step skips what is already gone.
 */
export function deleteAccountData() {
  breadcrumb('data', 'deleteAccountData')

  return guarded(
    'deleteAccountData',
    async ({ db, uid, FS }) => {
      // listTrips() caps at 30; an account on more than that takes a few
      // passes. Bounded, so a trip that somehow keeps matching cannot spin.
      for (let pass = 0; pass < 10; pass++) {
        const snap = await FS.getDocs(
          FS.query(
            FS.collection(db, 'trips'),
            FS.where('memberIds', 'array-contains', uid),
            FS.limit(30)
          )
        )
        if (snap.empty) break

        for (const doc of snap.docs) {
          const data = doc.data()
          const others = (data.memberIds ?? []).filter((id) => id !== uid)

          if (others.length === 0) {
            // Deleting is owner-only in the rules. A sole member who is not
            // the owner (the owner left earlier) takes ownership first.
            if (data.ownerId !== uid) await FS.updateDoc(doc.ref, { ownerId: uid })
            await purgeTrip(db, FS, doc.id, data)
            continue
          }

          await FS.deleteDoc(FS.doc(db, 'trips', doc.id, 'presence', uid))
          await FS.updateDoc(doc.ref, {
            memberIds: FS.arrayRemove(uid),
            [`members.${uid}`]: FS.deleteField(),
            ...(data.ownerId === uid
              ? { ownerId: others[0], [`members.${others[0]}`]: 'owner' }
              : {}),
            updatedAt: FS.serverTimestamp(),
          })
        }
      }

      await FS.deleteDoc(FS.doc(db, 'users', uid))
      return true
    },
    () => false
  )
}

/**
 * Everything this app keeps in the browser's own storage, gone — except the
 * interface language, which says nothing about anyone and would otherwise
 * flip a Hebrew reader to English on the reload that follows.
 */
export function clearLocalData() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith('tripai.') && key !== 'tripai.lang') keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    /* private mode — there was nothing stored to begin with */
  }
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
 * routes — one document per day, scoped under the family planning it.
 * Each family plans its own days independently, so the path carries both:
 * trips/{tripId}/families/{familyId}/routes/{day}. No rules change needed —
 * the generic member-write subcollection rule matches any depth under a
 * trip, not just one level.
 * ------------------------------------------------------------------ */

export function listRoutes(tripId, familyId) {
  if (!tripId || !familyId) return Promise.resolve([])

  return guarded(
    'listRoutes',
    async ({ db, FS }) => {
      const snap = await FS.getDocs(
        FS.query(
          FS.collection(db, 'trips', tripId, 'families', familyId, 'routes'),
          FS.orderBy('day', 'asc')
        )
      )
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    },
    () => localGet(`routes.${tripId}.${familyId}`, [])
  )
}

export function saveRoute(tripId, familyId, route) {
  if (!tripId || !familyId) return Promise.resolve(false)

  return guarded(
    'saveRoute',
    async ({ db, FS }) => {
      const id = route.id ?? `day-${route.day}`
      await FS.setDoc(
        FS.doc(db, 'trips', tripId, 'families', familyId, 'routes', id),
        { ...route, id, updatedAt: FS.serverTimestamp() },
        { merge: true }
      )
      return true
    },
    () => {
      const id = route.id ?? `day-${route.day}`
      const all = localGet(`routes.${tripId}.${familyId}`, []).filter((r) => r.id !== id)
      localSet(`routes.${tripId}.${familyId}`, [...all, { ...route, id }].sort((a, b) => a.day - b.day))
      return false
    }
  )
}

/**
 * Live updates for one family's routes — this is what makes a shared trip
 * feel shared: a stop someone else in the same family adds appears without
 * a refresh. Returns an unsubscribe function.
 */
export function watchRoutes(tripId, familyId, onChange) {
  if (!hasFirebase || !tripId || !familyId) {
    onChange(localGet(`routes.${tripId}.${familyId}`, []))
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
        FS.query(
          FS.collection(db, 'trips', tripId, 'families', familyId, 'routes'),
          FS.orderBy('day', 'asc')
        ),
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
 * ticket photos — a picture of the real boarding pass, attraction voucher
 * or confirmation, one per reservation. Kept as its own small document
 * under the trip rather than a field on the trip document itself — a
 * handful of photos inline there would push toward Firestore's 1MB-per-
 * document cap fast, and every other field on the trip would pay for it
 * on every read. No Firebase Storage involved (that now requires the
 * Blaze billing plan for a project's first bucket, a real card on file
 * even at zero usage) — the image is downscaled and compressed client-side
 * into a data URL and stored as a plain string field, well inside this
 * document's own 1MB limit. Covered by the existing generic
 * trips/{tripId}/{sub}/** membership rule, so no rules change either.
 * ------------------------------------------------------------------ */

export function loadTicketPhoto(tripId, ticketId) {
  if (!tripId || !ticketId) return Promise.resolve(null)
  return guarded(
    'loadTicketPhoto',
    async ({ db, FS }) => {
      const snap = await FS.getDoc(FS.doc(db, 'trips', tripId, 'tickets', ticketId))
      return snap.exists() ? (snap.data().dataUrl ?? null) : null
    },
    () => localGet(`ticket.${tripId}.${ticketId}`, null)
  )
}

export function saveTicketPhoto(tripId, ticketId, dataUrl) {
  if (!tripId || !ticketId) return Promise.resolve(false)
  return guarded(
    'saveTicketPhoto',
    async ({ db, FS }) => {
      await FS.setDoc(FS.doc(db, 'trips', tripId, 'tickets', ticketId), {
        dataUrl,
        updatedAt: FS.serverTimestamp(),
      })
      return true
    },
    () => {
      localSet(`ticket.${tripId}.${ticketId}`, dataUrl)
      return false
    }
  )
}

export function deleteTicketPhoto(tripId, ticketId) {
  if (!tripId || !ticketId) return Promise.resolve(false)
  return guarded(
    'deleteTicketPhoto',
    async ({ db, FS }) => {
      await FS.deleteDoc(FS.doc(db, 'trips', tripId, 'tickets', ticketId))
      return true
    },
    () => {
      localRemove(`ticket.${tripId}.${ticketId}`)
      return false
    }
  )
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

  // The date after which this entry may no longer be kept. Nothing in the
  // browser can delete from this collection (the rules forbid it), so
  // retention is enforced by a Firestore TTL policy on this field — see
  // LEGAL.md for the one-time console step that turns it on.
  const expireAt = FS.Timestamp.fromMillis(Date.now() + DIAGNOSTICS_RETENTION_DAYS * 86400000)

  for (const entry of batch) {
    const ref = FS.doc(FS.collection(db, 'diagnostics', uid, 'events'))
    writer.set(ref, { ...entry, uid, receivedAt: FS.serverTimestamp(), expireAt })
  }

  await writer.commit()
  return batch.length
}
