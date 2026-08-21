/**
 * Verifies a deployed Gemini proxy from the outside.
 *
 *   npm run worker:check -- https://tripai-ai.<subdomain>.workers.dev
 *
 * Checks liveness, that the origin allowlist actually refuses strangers, and
 * — if a key is configured — that a real completion comes back through it.
 */
const url = process.argv[2] ?? process.env.VITE_AI_PROXY_URL
if (!url) {
  console.error('usage: node scripts/worker-check.mjs <worker-url>')
  process.exit(1)
}

const ALLOWED = 'https://travel-ai-6de47.web.app'
const STRANGER = 'https://evil.example.com'

console.log(`\nworker: ${url}\n`)

/* 1 — liveness -------------------------------------------------------- */
const health = await fetch(url)
const info = await health.json()
console.log(`✔ GET ${health.status}`)
console.log(`  model:          ${info.model}`)
console.log(`  key configured: ${info.keyConfigured ? 'yes' : 'NO — run wrangler secret put GEMINI_API_KEY'}`)
console.log(`  allowed origins: ${info.allowedOrigins}`)

/* 2 — the allowlist has to actually refuse -------------------------- */
const pre = (origin) =>
  fetch(url, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  })

const good = await pre(ALLOWED)
const bad = await pre(STRANGER)

const goodHdr = good.headers.get('access-control-allow-origin')
const badHdr = bad.headers.get('access-control-allow-origin')

console.log(`\n✔ preflight from allowed origin  -> ${good.status}, allow-origin: ${goodHdr ?? '(none)'}`)
console.log(`${badHdr ? '✖' : '✔'} preflight from stranger        -> ${bad.status}, allow-origin: ${badHdr ?? '(none)'}`)

if (badHdr) {
  console.error('\n✖ the allowlist is not filtering — any site could use this proxy\n')
  process.exit(2)
}
if (!goodHdr) {
  console.error('\n✖ the real site is being refused too — check ALLOWED_ORIGINS\n')
  process.exit(2)
}

/* 3 — a real completion, if the key is set ---------------------------- */
if (!info.keyConfigured) {
  console.log('\n⚠ no key set yet, skipping the live call.\n')
  process.exit(0)
}

const started = Date.now()
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ALLOWED },
  body: JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'ענה בעברית במשפט אחד: מה כדאי לראות בפריז?' }] }],
    systemInstruction: { parts: [{ text: 'אתה סוכן נסיעות. ענה קצר בעברית.' }] },
  }),
})

if (!res.ok) {
  console.error(`\n✖ POST ${res.status}`)
  console.error((await res.text()).slice(0, 400))
  process.exit(1)
}

let buffer = ''
let text = ''
const reader = res.body.getReader()
const decoder = new TextDecoder()

const emit = (frame) => {
  const line = frame.split(/\r?\n/).find((l) => l.startsWith('data:'))
  if (!line) return
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return
  try {
    const json = JSON.parse(payload)
    text += (json?.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
  } catch { /* partial frame */ }
}

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  const frames = buffer.split(/\r?\n\r?\n/)
  buffer = frames.pop() ?? ''
  frames.forEach(emit)
}
buffer += decoder.decode()
if (buffer.trim()) emit(buffer)

console.log(`\n✔ POST 200 — ${Date.now() - started}ms`)
console.log(`  ${text.trim() || '(empty)'}\n`)
