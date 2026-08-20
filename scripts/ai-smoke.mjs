/**
 * End-to-end smoke test of the real Gemini path: streams one answer per
 * candidate model and prints it with latency and token usage.
 *
 *   npm run ai:smoke                                  # the configured model
 *   npm run ai:smoke -- gemini-3.6-flash gemini-3.1-flash-lite
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
const key = env.VITE_GEMINI_API_KEY
if (!key) {
  console.error('✖ אין VITE_GEMINI_API_KEY ב-.env.local')
  process.exit(1)
}

const models = process.argv.slice(2)
if (models.length === 0) models.push(env.VITE_GEMINI_MODEL ?? 'gemini-3.6-flash')

const QUESTION = 'הטיסה שלי מתעכבת בשעתיים ואני אמור להגיע ללובר ב-11:30. מה לעשות?'

for (const model of models) {
  const started = Date.now()
  let firstToken = null
  let usage = null
  let frames = 0

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: QUESTION }] }],
        systemInstruction: {
          parts: [{ text: 'אתה סוכן נסיעות של TripAI. ענה בעברית, קצר, 2-3 משפטים.' }],
        },
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
    }
  )

  if (!res.ok) {
    console.log(`\n✖ ${model} — HTTP ${res.status}`)
    console.log((await res.text()).slice(0, 300))
    continue
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''

  // Same parsing rules as src/lib/gemini.js: CRLF frame separators, and
  // `thought` parts filtered out of the visible answer.
  const emit = (frame) => {
    const line = frame.split(/\r?\n/).find((l) => l.startsWith('data:'))
    if (!line) return
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return

    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    frames++
    if (json.usageMetadata) usage = json.usageMetadata

    const delta = (json?.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')

    if (delta && firstToken === null) firstToken = Date.now() - started
    text += delta
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split(/\r?\n\r?\n/)
    buffer = parts.pop() ?? ''
    parts.forEach(emit)
  }
  buffer += decoder.decode()
  if (buffer.trim()) emit(buffer)

  console.log(
    `\n=== ${model} ===\n` +
      `טוקן ראשון ${firstToken}ms · סה"כ ${Date.now() - started}ms · ` +
      `${frames} frames · חשיבה ${usage?.thoughtsTokenCount ?? 0} · פלט ${usage?.candidatesTokenCount ?? '?'} טוקנים`
  )
  console.log(text.trim() || '(תשובה ריקה)')
}

console.log('')
