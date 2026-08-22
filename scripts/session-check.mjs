/**
 * Guards the bug that made signing in loop forever.
 *
 *   npm run session:check
 *
 * connect() used to call signInAnonymously() unconditionally, alongside the
 * auth listener. The SDK skips that call only when the current user is
 * *already anonymous* — with a real account restored from storage it goes
 * ahead and mints a fresh anonymous user instead. So every reload silently
 * signed the user out, the "save your trip" sheet came back, and signing in
 * again started the same cycle. Each pass burned a new uid too, which left
 * the trip unreadable, since access is by `memberIds`.
 *
 * Two halves, because neither is enough alone:
 *   1. live  — an anonymous sign-in never reuses an existing account, so
 *              calling it on a restored session is destructive, not a no-op.
 *   2. source — connect() must decide before it calls.
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

let failures = 0
const expect = (label, ok) => {
  console.log(`  ${ok ? '✔' : '✖'} ${label}`)
  if (!ok) failures++
}

/* ---- 1. live: anonymous sign-in always mints a new account ---- */

const env = { ...readEnv(), ...process.env }
const key = env.VITE_FB_API_KEY

console.log('\nwhat an anonymous sign-in does to an existing session:\n')

if (!key) {
  console.log('  … no VITE_FB_API_KEY, skipping the live half')
} else {
  const IDT = 'https://identitytoolkit.googleapis.com/v1'
  const call = async (path, body) => {
    const r = await fetch(`${IDT}/${path}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`)
    return j
  }

  const first = await call('accounts:signUp', { returnSecureToken: true })
  const second = await call('accounts:signUp', { returnSecureToken: true })

  expect('a session exists after the first sign-in', Boolean(first.localId))
  expect(
    'a second anonymous sign-in abandons it rather than reusing it',
    second.localId !== first.localId
  )
  console.log(
    `    ${first.localId.slice(0, 8)}… -> ${second.localId.slice(0, 8)}… — ` +
      'run that on a signed-in user and the account is simply gone'
  )

  await call('accounts:delete', { idToken: first.idToken }).catch(() => {})
  await call('accounts:delete', { idToken: second.idToken }).catch(() => {})
}

/* ---- 2. source: connect() has to look before it leaps ---- */

console.log('\nhow connect() decides:\n')

const src = readFileSync('src/lib/firebase.js', 'utf8')

// The original shape: the call sitting as a sibling of the listener, with
// nothing between it and the promise closing.
const unconditional = /\n\s*AUTH\.signInAnonymously\(auth\)\.catch\(reject\)\s*\n\s*\}\)/.test(src)
expect('signInAnonymously is not called unconditionally', !unconditional)

// It belongs on the branch where the listener reported no user at all.
const guarded =
  /if \(u\) \{[\s\S]{0,220}?resolve\(u\)[\s\S]{0,400}?AUTH\.signInAnonymously\(auth\)/.test(src)
expect('it runs only after the listener reports no session', guarded)

// And the uid handed to the database layer has to track the current user,
// or every write after a sign-in lands under the abandoned account.
expect('the connection exposes a live uid, not a snapshot', /get uid\(\)/.test(src))
expect('no captured `uid:` on the returned connection', !/\buid: user\.uid\b/.test(src))

console.log(
  failures === 0
    ? '\n✔ a signed-in session survives a reload\n'
    : `\n✖ ${failures} failed — sign-in will loop\n`
)
process.exit(failures === 0 ? 0 : 1)
