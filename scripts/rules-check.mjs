/**
 * Proves the trip rules enforce what they claim, using two separate anonymous
 * accounts against the live project.
 *
 *   npm run rules:check
 *
 * Rules that fail open and rules that fail closed both pass a one-sided test,
 * so every case is checked from both directions: the member who should get in,
 * and the stranger who should not.
 */
import { readFileSync, existsSync } from 'node:fs'

function readEnv() {
  const out = {}
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const env = { ...readEnv(), ...process.env }
const key = env.VITE_FB_API_KEY
const project = env.VITE_FB_PROJECT_ID

if (!key || !project) {
  console.error('✖ missing VITE_FB_API_KEY / VITE_FB_PROJECT_ID')
  process.exit(1)
}

const DOCS = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`

const signUp = async (label) => {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"returnSecureToken":true}' }
  )
  const j = await r.json()
  if (!r.ok) throw new Error(`${label}: ${j?.error?.message}`)
  return { uid: j.localId, token: j.idToken, label }
}

const call = (user, path, method, body) =>
  fetch(`${DOCS}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

let failures = 0
const expect = (label, ok) => {
  console.log(`  ${ok ? '✔' : '✖'} ${label}`)
  if (!ok) failures++
}

const alice = await signUp('alice')
const bob = await signUp('bob')
console.log(`\nalice ${alice.uid}\nbob   ${bob.uid}\n`)

const tripId = `ruletest-${Date.now().toString(36)}`
const str = (v) => ({ stringValue: v })
const arr = (v) => ({ arrayValue: { values: v.map(str) } })

/* ---- alice creates a trip she is a member of ---- */
const create = await call(alice, `trips?documentId=${tripId}`, 'POST', {
  fields: {
    destination: str('RuleTest'),
    ownerId: str(alice.uid),
    memberIds: arr([alice.uid]),
    members: { mapValue: { fields: { [alice.uid]: str('owner') } } },
  },
})
expect('owner can create a trip listing herself', create.ok)

if (!create.ok) {
  console.error((await create.text()).slice(0, 400))
  process.exit(1)
}

/* ---- membership gates reading ---- */
expect('owner can read her trip', (await call(alice, `trips/${tripId}`, 'GET')).ok)
expect('stranger cannot read it', !(await call(bob, `trips/${tripId}`, 'GET')).ok)

/* ---- a stranger may add himself, and nothing else ---- */
const sneak = await call(
  bob,
  `trips/${tripId}?updateMask.fieldPaths=destination`,
  'PATCH',
  { fields: { destination: str('HIJACKED') } }
)
expect('stranger cannot edit trip contents', !sneak.ok)

const join = await call(
  bob,
  `trips/${tripId}?updateMask.fieldPaths=memberIds&updateMask.fieldPaths=members`,
  'PATCH',
  {
    fields: {
      memberIds: arr([alice.uid, bob.uid]),
      members: {
        mapValue: { fields: { [alice.uid]: str('owner'), [bob.uid]: str('editor') } },
      },
    },
  }
)
expect('stranger holding the trip id can join it', join.ok)
if (!join.ok) console.error('    ' + (await join.text()).slice(0, 260))

/* ---- once a member, full access ---- */
expect('new member can now read the trip', (await call(bob, `trips/${tripId}`, 'GET')).ok)

const route = await call(
  bob,
  `trips/${tripId}/routes?documentId=day-1`,
  'POST',
  { fields: { day: { integerValue: '1' }, city: str('RuleTest') } }
)
expect('member can write a day of the itinerary', route.ok)

/* ---- a third party is still shut out of the subcollection ---- */
const carol = await signUp('carol')
expect(
  'non-member cannot read the itinerary',
  !(await call(carol, `trips/${tripId}/routes/day-1`, 'GET')).ok
)

/* ---- only the owner deletes ---- */
expect('member cannot delete the trip', !(await call(bob, `trips/${tripId}`, 'DELETE')).ok)

/* ---- crash log is write-only ---- */
const diag = await call(alice, `diagnostics/${alice.uid}/events`, 'POST', {
  fields: { kind: str('test'), message: str('rules check') },
})
expect('device can report an error', diag.ok)
expect(
  'device cannot read the crash log back',
  !(await call(alice, `diagnostics/${alice.uid}/events`, 'GET')).ok
)

/* ---- tidy up ---- */
await call(alice, `trips/${tripId}/routes/day-1`, 'DELETE')
await call(alice, `trips/${tripId}`, 'DELETE')

console.log(failures === 0 ? '\n✔ every rule behaved as specified\n' : `\n✖ ${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
