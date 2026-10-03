/**
 * Tests firebase.rules against the local emulators — no real project, no
 * real data, safe to run any time.
 *
 *   firebase emulators:start --only auth,firestore --project demo-tripai
 *   npm run rules:test
 *
 * Like rules:check (which runs against the live project), every case is
 * checked from both sides: the person who should get in, and the one who
 * should not. A rule that fails open and a rule that fails closed both pass
 * a one-sided test.
 *
 * Exits 1 on any failure.
 */
import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, signInAnonymously } from 'firebase/auth'
import {
  initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, updateDoc, deleteDoc,
  setDoc, arrayUnion, deleteField, collection, addDoc, writeBatch, setLogLevel,
} from 'firebase/firestore'

// Every denied write is also logged by the SDK; the checks below already
// say what happened.
setLogLevel('silent')

const PROJECT = 'demo-tripai'
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

try {
  await fetch('http://127.0.0.1:8080/')
} catch {
  console.error('\n✖ the Firestore emulator is not running. Start it with:\n  firebase emulators:start --only auth,firestore --project demo-tripai\n')
  process.exit(1)
}

/* ---- setup ---- */

let n = 0
async function person() {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` }, `p${n++}`)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const db = initializeFirestore(app, {})
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  const { user } = await signInAnonymously(auth)
  return { db, uid: user.uid }
}

const enc = (v) => {
  if (v === null) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'number') return { integerValue: String(v) }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } }
}
/** Writes a document as an administrator, bypassing the rules. */
const seed = (path, data) =>
  fetch(`${FS}/${path}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields: enc(data).mapValue.fields }) })

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })

const owner = await person()
const member = await person()
const stranger = await person()
const second = await person()

/** A trip owned by `owner` with `member` as an editor, optionally with links. */
async function trip(id, { edit, view, extra = {} } = {}) {
  await seed(`trips/${id}`, {
    ownerId: owner.uid,
    memberIds: [owner.uid, member.uid],
    members: { [owner.uid]: 'owner', [member.uid]: 'editor' },
    destination: 'Paris',
    ...extra,
  })
  if (edit) await seed(`trips/${id}/secrets/edit`, { token: edit })
  if (view) await seed(`trips/${id}/secrets/view`, { token: view })
}

/* ---- the checks ---- */

let failed = 0
async function expect(label, allowed, attempt) {
  let ok = true
  try {
    await attempt()
  } catch (err) {
    if (err?.code !== 'permission-denied') throw err
    ok = false
  }
  const pass = ok === allowed
  if (!pass) failed++
  console.log(`${pass ? '✔' : '✖'} ${allowed ? 'allowed' : 'denied '}  ${label}${pass ? '' : `  (was ${ok ? 'allowed' : 'denied'})`}`)
}

/** Joins the way the app does: the token into joins/{uid}, in the same batch. */
function joinAs(who, id, { role = 'editor', token, extra = {} } = {}) {
  const batch = writeBatch(who.db)
  if (token != null) batch.set(doc(who.db, 'trips', id, 'joins', who.uid), { token })
  batch.update(doc(who.db, 'trips', id), {
    [`members.${who.uid}`]: role,
    memberIds: arrayUnion(who.uid),
    ...extra,
  })
  return batch.commit()
}

console.log('\nreading')
await trip('t1', { edit: 'e1', view: 'v1' })
await expect('a member reads the trip', true, () => getDoc(doc(member.db, 'trips', 't1')))
await expect('a stranger reads the trip', false, () => getDoc(doc(stranger.db, 'trips', 't1')))

console.log('\ncreating trips')
await expect('create a trip of your own', true, () => setDoc(doc(stranger.db, 'trips', 'mine'), {
  ownerId: stranger.uid, memberIds: [stranger.uid], members: { [stranger.uid]: 'owner' },
}))
await expect("create a trip that lists someone else (it would appear in their list)", false, () => setDoc(doc(stranger.db, 'trips', 'spam'), {
  ownerId: stranger.uid, memberIds: [stranger.uid, member.uid], members: { [stranger.uid]: 'owner' },
}))

console.log('\njoining a trip from before invite links')
await trip('legacy')
await expect('join with the id alone, as an editor', true, () => joinAs(stranger, 'legacy'))

console.log('\njoining with an edit link')
await expect('join without a token', false, () => joinAs(second, 't1'))
await expect('join with a wrong token', false, () => joinAs(second, 't1', { token: 'guess' }))
await expect('join as an owner', false, () => joinAs(second, 't1', { role: 'owner', token: 'e1' }))
await expect('join and demote someone else', false, () => joinAs(second, 't1', { token: 'e1', extra: { [`members.${member.uid}`]: 'viewer' } }))
await expect('join and take ownership', false, () => joinAs(second, 't1', { token: 'e1', extra: { ownerId: second.uid } }))
await expect('join with the edit token', true, () => joinAs(second, 't1', { token: 'e1' }))

console.log('\nthe tokens are not readable by those they would let in')
await trip('t2', { edit: 'e2', view: 'v2' })
const viewer = await person()
await expect('join as a viewer with the view token', true, () => joinAs(viewer, 't2', { role: 'viewer', token: 'v2' }))
await expect('a viewer reads the trip', true, () => getDoc(doc(viewer.db, 'trips', 't2')))
await expect('a viewer reads the edit token', false, () => getDoc(doc(viewer.db, 'trips', 't2', 'secrets', 'edit')))
await expect('a viewer reads the view token (to pass on the view link)', true, () => getDoc(doc(viewer.db, 'trips', 't2', 'secrets', 'view')))
await expect("a viewer reads others' join records", false, () => getDocs(collection(viewer.db, 'trips', 't2', 'joins')))
await expect('an editor reads the edit token', true, () => getDoc(doc(member.db, 'trips', 't2', 'secrets', 'edit')))
await expect('a stranger reads the view token', false, () => getDoc(doc(stranger.db, 'trips', 't2', 'secrets', 'view')))

console.log('\nno way from viewer to editor')
const sneaky = await person()
await expect('join as an editor with the view token', false, () => joinAs(sneaky, 't2', { token: 'v2' }))
await expect('a viewer makes themselves an editor', false, () => updateDoc(doc(viewer.db, 'trips', 't2'), { [`members.${viewer.uid}`]: 'editor' }))
await expect('a viewer re-joins while a member (to change role)', false, () => joinAs(viewer, 't2', { token: 'v2' }))
await expect('a viewer adds a duplicate of themselves', false, () => updateDoc(doc(viewer.db, 'trips', 't2'), {
  memberIds: [owner.uid, member.uid, viewer.uid, viewer.uid], [`members.${viewer.uid}`]: 'editor',
}))
await expect('a viewer edits the trip', false, () => updateDoc(doc(viewer.db, 'trips', 't2'), { destination: 'Rome' }))
await expect('a viewer writes a day plan', false, () => setDoc(doc(viewer.db, 'trips', 't2', 'families', 'p1', 'routes', 'day-1'), { stops: [] }))
await expect('a viewer reads a day plan', true, () => getDoc(doc(viewer.db, 'trips', 't2', 'families', 'p1', 'routes', 'day-1')))
await expect('a viewer replaces the tokens', false, () => setDoc(doc(viewer.db, 'trips', 't2', 'secrets', 'view'), { token: 'mine' }))
await expect('a viewer leaves', true, () => updateDoc(doc(viewer.db, 'trips', 't2'), {
  memberIds: [owner.uid, member.uid], [`members.${viewer.uid}`]: deleteField(),
}))
await expect('…and cannot come back as an editor without the edit token', false, () => joinAs(viewer, 't2', { token: 'v2' }))
await expect('…but can come back as a viewer', true, () => joinAs(viewer, 't2', { role: 'viewer', token: 'v2' }))

console.log('\nrevoking links')
await expect('an editor replaces the edit token', true, () => setDoc(doc(member.db, 'trips', 't2', 'secrets', 'edit'), { token: 'e2-new' }))
const late = await person()
await expect('join with the old edit token', false, () => joinAs(late, 't2', { token: 'e2' }))
await expect('join with the new edit token', true, () => joinAs(late, 't2', { token: 'e2-new' }))

console.log('\nlive location')
await expect('a viewer shares their own location', true, () => setDoc(doc(viewer.db, 'trips', 't2', 'presence', viewer.uid), { lat: 1, lng: 1 }))
await expect("a viewer writes someone else's location", false, () => setDoc(doc(viewer.db, 'trips', 't2', 'presence', member.uid), { lat: 1, lng: 1 }))
await expect("an editor fakes someone else's location", false, () => setDoc(doc(member.db, 'trips', 't2', 'presence', viewer.uid), { lat: 9, lng: 9 }))
await expect("an editor removes someone's location (deleting the trip)", true, () => deleteDoc(doc(member.db, 'trips', 't2', 'presence', viewer.uid)))

console.log('\nleaving and deleting')
await trip('leave')
await expect('a member removes themselves', true, () => updateDoc(doc(member.db, 'trips', 'leave'), {
  memberIds: [owner.uid], [`members.${member.uid}`]: deleteField(),
}))
await trip('del', { edit: 'x', view: 'y' })
await expect('a non-owner member deletes the trip', false, () => deleteDoc(doc(member.db, 'trips', 'del')))
await expect('the owner removes the secrets', true, () => deleteDoc(doc(owner.db, 'trips', 'del', 'secrets', 'edit')))
await expect('the owner deletes the trip', true, () => deleteDoc(doc(owner.db, 'trips', 'del')))

console.log('\nwhat is under a trip')
await trip('sub')
await expect('a member writes a ticket photo', true, () => setDoc(doc(member.db, 'trips', 'sub', 'tickets', 't1'), { dataUrl: 'x' }))
await expect('a stranger reads a ticket photo', false, () => getDoc(doc(stranger.db, 'trips', 'sub', 'tickets', 't1')))
await expect('a stranger writes a day plan', false, () => setDoc(doc(stranger.db, 'trips', 'sub', 'families', 'p1', 'routes', 'day-1'), { stops: [] }))

console.log('\nprofiles and the crash log')
await expect('you write your own profile', true, () => setDoc(doc(member.db, 'users', member.uid), { currentTripId: 'sub' }))
await expect("you read someone else's profile", false, () => getDoc(doc(stranger.db, 'users', member.uid)))
await expect('you log your own crash', true, () => addDoc(collection(member.db, 'diagnostics', member.uid, 'events'), { message: 'x', stack: null }))
await expect('you log a crash as someone else', false, () => addDoc(collection(stranger.db, 'diagnostics', member.uid, 'events'), { message: 'x' }))
await expect('you log a 100 KB "crash"', false, () => addDoc(collection(member.db, 'diagnostics', member.uid, 'events'), { message: 'x'.repeat(100000) }))

console.log(failed ? `\n✖ ${failed} check(s) failed\n` : '\n✔ all rules behave as intended\n')
process.exit(failed ? 1 : 0)
