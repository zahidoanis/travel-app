/**
 * Deploys firebase.rules through the Firebase Rules API.
 *
 *   npm run rules:deploy
 *
 * `firebase deploy --only firestore:rules` first asks Service Usage whether
 * the Firestore API is enabled, and the Admin SDK service account is not
 * granted that check — it fails 403 before it ever reaches the rules. Talking
 * to firebaserules.googleapis.com directly skips the precheck and uses only
 * the permission the service account actually has.
 *
 * Needs GOOGLE_APPLICATION_CREDENTIALS pointing at the service-account JSON.
 */
import { readFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
if (!keyPath || !existsSync(keyPath)) {
  console.error('✖ GOOGLE_APPLICATION_CREDENTIALS is not set, or the file is missing.')
  process.exit(1)
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'))
const project = key.project_id
const rulesFile = process.argv[2] ?? 'firebase.rules'
const source = readFileSync(rulesFile, 'utf8')

/* ---- mint an access token from the service account ---- */

const b64 = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url')

const now = Math.floor(Date.now() / 1000)
const claim = {
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/firebase',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
}

const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claim)}`
const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`,
  }),
})

if (!tokenRes.ok) {
  console.error('✖ could not obtain an access token')
  console.error((await tokenRes.text()).slice(0, 400))
  process.exit(1)
}

const { access_token: token } = await tokenRes.json()
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

console.log(`\nproject: ${project}`)
console.log(`rules:   ${rulesFile} (${source.split('\n').length} lines)\n`)

/* ---- upload the ruleset ---- */

const created = await fetch(
  `https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`,
  {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: source }] } }),
  }
)

if (!created.ok) {
  const body = await created.text()
  console.error(`✖ ruleset rejected (HTTP ${created.status})`)
  // Syntax errors come back here with line numbers, which is the whole
  // reason to surface the raw body.
  console.error(body.slice(0, 1200))
  process.exit(1)
}

const ruleset = await created.json()
console.log(`✔ ruleset compiled: ${ruleset.name.split('/').pop()}`)

/* ---- point the live release at it ---- */

const release = `projects/${project}/releases/cloud.firestore`
const published = await fetch(
  `https://firebaserules.googleapis.com/v1/${release}?updateMask=rulesetName`,
  {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ release: { name: release, rulesetName: ruleset.name } }),
  }
)

if (!published.ok) {
  console.error(`✖ release failed (HTTP ${published.status})`)
  console.error((await published.text()).slice(0, 600))
  process.exit(1)
}

console.log('✔ rules are live\n')
