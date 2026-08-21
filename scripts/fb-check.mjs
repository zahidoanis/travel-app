/**
 * Verifies the Firebase wiring end to end, without a browser.
 *
 *   npm run fb:check
 *
 * Checks, in order:
 *   1. the config in .env.local parses and points at a real project
 *   2. anonymous sign-in is enabled and issues a uid
 *   3. security rules are actually being enforced
 *
 * Step 3 is the one worth having: a rules file that silently fails open is
 * far worse than one that fails closed, and you cannot tell from the console.
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
const projectId = env.VITE_FB_PROJECT_ID

if (!key || !projectId) {
  console.error('\n✖ חסרים VITE_FB_API_KEY או VITE_FB_PROJECT_ID ב-.env.local\n')
  process.exit(1)
}

console.log(`\nפרויקט: ${projectId}\n`)

/* 1 + 2 — anonymous sign-in ------------------------------------------- */

const signIn = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  }
)

const auth = await signIn.json()

if (!signIn.ok) {
  const msg = auth?.error?.message ?? ''
  console.error(`✖ הזדהות אנונימית נכשלה (HTTP ${signIn.status}): ${msg}`)
  if (/ADMIN_ONLY_OPERATION|OPERATION_NOT_ALLOWED/i.test(msg)) {
    console.error('\n  ספק Anonymous לא מופעל.')
    console.error('  Authentication → Sign-in method → Anonymous → Enable\n')
  }
  process.exit(1)
}

console.log(`✔ הזדהות אנונימית עובדת. uid: ${auth.localId}`)

/* 3 — are the rules enforced? ----------------------------------------- */

const docUrl = (path) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`

// Write somewhere the rules must reject: another user's document.
const intruder = await fetch(docUrl('users/not-my-uid-probe'), {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.idToken}`,
  },
  body: JSON.stringify({ fields: { probe: { stringValue: 'should be denied' } } }),
})

if (intruder.ok) {
  console.error('\n✖ אזהרה: הצלחתי לכתוב למסמך של משתמש אחר.')
  console.error('  כללי האבטחה לא נאכפים — צריך לפרוס את firebase.rules.\n')
  process.exit(2)
}

console.log(`✔ כללי האבטחה חוסמים גישה למסמך של משתמש אחר (${intruder.status})`)

// Now write where the rules should allow it: the caller's own document.
const own = await fetch(docUrl(`users/${auth.localId}`), {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.idToken}`,
  },
  body: JSON.stringify({ fields: { probe: { stringValue: 'fb-check' } } }),
})

if (own.ok) {
  console.log('✔ כתיבה למסמך של המשתמש עצמו מותרת')
  console.log('\n✔ הכול מחובר ועובד.\n')

  // Tidy up after ourselves.
  await fetch(docUrl(`users/${auth.localId}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${auth.idToken}` },
  })
  process.exit(0)
}

const detail = await own.text()
console.log(`\n⚠ כתיבה למסמך של המשתמש עצמו נדחתה (${own.status}).`)
if (own.status === 403 || /PERMISSION_DENIED/.test(detail)) {
  console.log('  זה צפוי כל עוד לא נפרסו הכללים — ברירת המחדל חוסמת הכול.')
  console.log('  אחרי פריסת firebase.rules הבדיקה הזו אמורה לעבור.\n')
  process.exit(3)
}
console.log(detail.slice(0, 300))
process.exit(1)
