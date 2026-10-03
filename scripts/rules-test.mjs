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
  initializeFirestore, connectFirestoreEmulator, doc, getDoc, updateDoc, deleteDoc,
  setDoc, arrayUnion, deleteField, collection, addDoc, setLogLevel,
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

const trip = (id, extra = {}) => seed(`trips/${id}`, {
  ownerId: owner.uid,
  memberIds: [owner.uid, member.uid],
  members: { [owner.uid]: 'owner', [member.uid]: 'editor' },
  destination: 'Paris',
  ...extra,
})
await trip('legacy')
await trip('tokened', { inviteToken: 'secret-1' })

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

const joinAs = (who, id, extra = {}) =>
  updateDoc(doc(who.db, 'trips', id), {
    [`members.${who.uid}`]: 'editor',
    memberIds: arrayUnion(who.uid),
    ...extra,
  })

console.log('\nreading')
await expect('a member reads the trip', true, () => getDoc(doc(member.db, 'trips', 'tokened')))
await expect('a stranger reads the trip', false, () => getDoc(doc(stranger.db, 'trips', 'tokened')))

console.log('\njoining a trip from before invite tokens')
await expect('join with the id alone', true, () => joinAs(stranger, 'legacy'))

console.log('\njoining a trip with an invite token')
await expect('join without the token', false, () => joinAs(second, 'tokened'))
await expect('join with a wrong token', false, () => joinAs(second, 'tokened', { [`joinedWith.${second.uid}`]: 'guess' }))
await expect('join as an owner', false, () => joinAs(second, 'tokened', { [`members.${second.uid}`]: 'owner', [`joinedWith.${second.uid}`]: 'secret-1' }))
await expect('join and demote someone else', false, () => joinAs(second, 'tokened', { [`members.${member.uid}`]: 'viewer', [`joinedWith.${second.uid}`]: 'secret-1' }))
await expect('join and take ownership', false, () => joinAs(second, 'tokened', { ownerId: second.uid, [`joinedWith.${second.uid}`]: 'secret-1' }))
await expect('join with the right token', true, () => joinAs(second, 'tokened', { [`joinedWith.${second.uid}`]: 'secret-1' }))
await expect("ride on someone else's stored token", false, () => joinAs(stranger, 'tokened'))

console.log('\nrevoking a link')
await expect('a member replaces the token', true, () => updateDoc(doc(member.db, 'trips', 'tokened'), { inviteToken: 'secret-2' }))
await expect('join with the old token', false, () => joinAs(stranger, 'tokened', { [`joinedWith.${stranger.uid}`]: 'secret-1' }))
await expect('join with the new token', true, () => joinAs(stranger, 'tokened', { [`joinedWith.${stranger.uid}`]: 'secret-2' }))

console.log('\nview-only links')
await trip('shared', { inviteToken: 'edit-1', viewToken: 'view-1' })
const viewer = await person()
await expect('join as a viewer with the view token', true, () => updateDoc(doc(viewer.db, 'trips', 'shared'), {
  [`members.${viewer.uid}`]: 'viewer', memberIds: arrayUnion(viewer.uid), [`joinedWith.${viewer.uid}`]: 'view-1',
}))
const sneaky = await person()
await expect('join as an editor with the view token', false, () => updateDoc(doc(sneaky.db, 'trips', 'shared'), {
  [`members.${sneaky.uid}`]: 'editor', memberIds: arrayUnion(sneaky.uid), [`joinedWith.${sneaky.uid}`]: 'view-1',
}))
await expect('a viewer reads the trip', true, () => getDoc(doc(viewer.db, 'trips', 'shared')))
await expect('a viewer edits the trip', false, () => updateDoc(doc(viewer.db, 'trips', 'shared'), { destination: 'Rome' }))
await expect('a viewer makes themselves an editor', false, () => updateDoc(doc(viewer.db, 'trips', 'shared'), { [`members.${viewer.uid}`]: 'editor' }))
await expect('a viewer writes a day plan', false, () => setDoc(doc(viewer.db, 'trips', 'shared', 'families', 'p1', 'routes', 'day-1'), { stops: [] }))
await expect('a viewer reads a day plan', true, () => getDoc(doc(viewer.db, 'trips', 'shared', 'families', 'p1', 'routes', 'day-1')))
await expect('a viewer shares their own location', true, () => setDoc(doc(viewer.db, 'trips', 'shared', 'presence', viewer.uid), { lat: 1, lng: 1 }))
await expect("a viewer writes someone else's location", false, () => setDoc(doc(viewer.db, 'trips', 'shared', 'presence', member.uid), { lat: 1, lng: 1 }))
await expect('an editor still edits', true, () => updateDoc(doc(member.db, 'trips', 'shared'), { destination: 'Rome' }))
await expect('an editor makes a viewer an editor', true, () => updateDoc(doc(member.db, 'trips', 'shared'), { [`members.${viewer.uid}`]: 'editor' }))
await expect('…and back', true, () => updateDoc(doc(member.db, 'trips', 'shared'), { [`members.${viewer.uid}`]: 'viewer' }))
await expect('a viewer leaves the trip', true, () => updateDoc(doc(viewer.db, 'trips', 'shared'), {
  memberIds: [owner.uid, member.uid], [`members.${viewer.uid}`]: deleteField(),
}))

console.log('\nleaving and deleting')
await trip('leave')
await expect('a member removes themselves', true, () => updateDoc(doc(member.db, 'trips', 'leave'), {
  memberIds: [owner.uid], [`members.${member.uid}`]: deleteField(),
}))
await trip('del')
await expect('a non-owner member deletes the trip', false, () => deleteDoc(doc(member.db, 'trips', 'del')))
await expect('the owner deletes the trip', true, () => deleteDoc(doc(owner.db, 'trips', 'del')))

console.log('\nwhat is under a trip')
await trip('sub')
await expect('a member writes a ticket photo', true, () => setDoc(doc(member.db, 'trips', 'sub', 'tickets', 't1'), { dataUrl: 'x' }))
await expect('a stranger reads a ticket photo', false, () => getDoc(doc(stranger.db, 'trips', 'sub', 'tickets', 't1')))
await expect('a stranger writes a day plan', false, () => setDoc(doc(stranger.db, 'trips', 'sub', 'families', 'p1', 'routes', 'day-1'), { stops: [] }))

console.log('\nprofiles and the crash log')
await expect('you write your own profile', true, () => setDoc(doc(member.db, 'users', member.uid), { currentTripId: 'sub' }))
await expect("you read someone else's profile", false, () => getDoc(doc(stranger.db, 'users', member.uid)))
await expect('you log your own crash', true, () => addDoc(collection(member.db, 'diagnostics', member.uid, 'events'), { message: 'x' }))
await expect("you log a crash as someone else", false, () => addDoc(collection(stranger.db, 'diagnostics', member.uid, 'events'), { message: 'x' }))

console.log(failed ? `\n✖ ${failed} check(s) failed\n` : '\n✔ all rules behave as intended\n')
process.exit(failed ? 1 : 0)
