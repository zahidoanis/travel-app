/**
 * Reports which sign-in providers the project actually has enabled.
 *
 *   npm run auth:check
 *
 * Exists because "sign-in does nothing" and "sign-in is switched off in the
 * console" look identical from the browser: the SDK rejects with
 * `auth/operation-not-allowed`, which reads like a bug in the app.
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

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const now = Math.floor(Date.now() / 1000)

const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`
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
  console.error((await tokenRes.text()).slice(0, 300))
  process.exit(1)
}

const { access_token: token } = await tokenRes.json()
const auth = { Authorization: `Bearer ${token}` }

/* ---- the providers Google itself hosts (google.com, facebook, ...) ---- */
const idpRes = await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs`,
  { headers: auth }
)
const idp = await idpRes.json()

if (!idpRes.ok) {
  console.error(`✖ ${idp?.error?.message ?? idpRes.status}`)
  process.exit(1)
}

const configs = idp.defaultSupportedIdpConfigs ?? []
const google = configs.find((c) => c.name?.endsWith('/google.com'))

/* ---- anonymous and email/password live on the project config ---- */
const cfgRes = await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`,
  { headers: auth }
)
const cfg = await cfgRes.json()

console.log(`\nproject ${project}\n`)

const line = (label, on, note = '') =>
  console.log(`  ${on ? '✔' : '✖'} ${label}${note ? `  ${note}` : ''}`)

line('anonymous', cfg?.signIn?.anonymous?.enabled === true)
line('email / password', cfg?.signIn?.email?.enabled === true)
line(
  'google',
  Boolean(google && google.enabled !== false),
  google ? '' : '(no config — never enabled in the console)'
)

/* ---- authorised domains, the other thing that breaks a popup ---- */
const domains = cfg?.authorizedDomains ?? []
console.log(`\n  authorised domains: ${domains.join(', ') || '(none)'}`)

const needed = [`${project}.web.app`, `${project}.firebaseapp.com`, 'localhost']
const missing = needed.filter((d) => !domains.includes(d))
if (missing.length) console.log(`  ✖ missing: ${missing.join(', ')}`)

const ok = google && google.enabled !== false && missing.length === 0
console.log(
  ok
    ? '\n✔ Google sign-in is enabled and the hosting domain is authorised\n'
    : '\n✖ Google sign-in will fail in the browser — see above\n'
)
process.exit(ok ? 0 : 1)
