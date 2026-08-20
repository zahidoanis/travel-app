/**
 * Verifies the Gemini key and lists the models it can actually use.
 *
 *   npm run ai:check
 *
 * Model availability on the free tier changes over time, so check here rather
 * than trusting a hardcoded name.
 */
import { readFileSync, existsSync } from 'node:fs'

function readEnv() {
  const out = {}
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
    }
  }
  return out
}

const env = { ...readEnv(), ...process.env }
const key = env.VITE_GEMINI_API_KEY

if (!key) {
  console.error('\n✖ לא נמצא VITE_GEMINI_API_KEY.')
  console.error('  צור קובץ .env.local בשורש הפרויקט ובתוכו:\n')
  console.error('  VITE_GEMINI_API_KEY=AIza...\n')
  process.exit(1)
}

console.log(`\nבודק מפתח …${key.slice(-6)}\n`)

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
)

if (!res.ok) {
  const body = await res.text()
  console.error(`✖ המפתח נדחה (HTTP ${res.status})`)
  console.error(body.slice(0, 600))
  console.error('\nבדוק: המפתח הועתק במלואו, וה-Generative Language API מופעל בפרויקט.\n')
  process.exit(1)
}

const { models = [] } = await res.json()

// Only models that can actually answer a chat turn are useful to us.
const usable = models.filter((m) => m.supportedGenerationMethods?.includes('generateContent'))

console.log(`✔ המפתח תקין. ${usable.length} דגמים זמינים לצ'אט:\n`)

for (const m of usable) {
  const name = m.name.replace('models/', '')
  const flash = /flash/i.test(name) ? '  ← מהיר וזול, מומלץ' : ''
  console.log(`  ${name.padEnd(42)} ${String(m.inputTokenLimit ?? '?').padStart(9)} tokens${flash}`)
}

const wanted = env.VITE_GEMINI_MODEL ?? 'gemini-3.6-flash'

// Being in the list is not the same as being callable: Google keeps retired
// models listed but rejects them for new keys. Probe it for real.
console.log(`\nבודק שהדגם ${wanted} באמת עונה …`)

const probe = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${wanted}:generateContent?key=${encodeURIComponent(key)}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'שלום' }] }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
  }
)

if (probe.ok) {
  console.log(`\n✔ ${wanted} זמין ועובד.\n`)
  process.exit(0)
}

let message = ''
try {
  message = (await probe.json())?.error?.message ?? ''
} catch {
  /* non-JSON */
}

console.error(`\n✖ ${wanted} החזיר HTTP ${probe.status}`)
if (message) console.error(`  ${message}`)
console.error('\n  בחר דגם מהרשימה למעלה והוסף ל-.env.local:')
console.error('  VITE_GEMINI_MODEL=<שם הדגם>\n')
process.exit(1)
