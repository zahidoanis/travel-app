/**
 * Gemini client for the TripAI agent.
 *
 * Two wiring modes, in priority order:
 *
 *   1. VITE_AI_PROXY_URL — calls your own endpoint, which holds the key
 *      server-side. This is the mode to ship. See worker/ for a Cloudflare
 *      Worker you can deploy free without a credit card.
 *
 *   2. VITE_GEMINI_API_KEY — calls Google directly from the browser. Fastest
 *      way to get running, but the key ends up in the bundle. Restrict it by
 *      HTTP referrer and treat it as a development/demo key only.
 *
 * With neither set, the chat falls back to its scripted responses.
 */

const PROXY = import.meta.env?.VITE_AI_PROXY_URL ?? ''
const KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? ''
const MODEL = import.meta.env?.VITE_GEMINI_MODEL ?? 'gemini-2.5-flash'

const API = 'https://generativelanguage.googleapis.com/v1beta'

export const hasAI = Boolean(PROXY || KEY)
export const aiMode = PROXY ? 'proxy' : KEY ? 'direct' : 'off'
export const aiModel = MODEL

/** Builds the agent's standing instructions, grounded in the actual trip. */
export function systemPrompt({ trip, stops, families, prefs }) {
  const itinerary = stops
    .map((s, i) => `${i + 1}. ${s.time} — ${s.he} (${s.desc})`)
    .join('\n')

  const parties = families
    .map((f) => `- ${f.name}: ${f.members.length} נוסעים${f.joined ? '' : ' (טרם הצטרפו)'}`)
    .join('\n')

  return `אתה סוכן הנסיעות של TripAI. אתה עוזר לקבוצה שמטיילת ב${trip.city}, ${trip.country}.

היום: יום ${trip.day} מתוך ${trip.totalDays}. מזג האוויר: ${trip.weather}, ${trip.temp}°C.

הלו"ז של היום:
${itinerary}

הקבוצה:
${parties}

${prefs ? `העדפות שהקבוצה הגדירה: ${prefs}` : ''}

כללי עבודה:
- ענה תמיד בעברית, בגוף שני, בטון ידידותי ותכליתי.
- היה קצר. 2-4 משפטים אלא אם ביקשו פירוט.
- כשאתה מציע שינוי בלו"ז, תן אפשרות קונקרטית אחת או שתיים עם שעות ומקומות, לא רשימה ארוכה.
- התייחס למרחקים ולזמני הגעה סבירים בין העצירות שבלו"ז.
- אם משפחה מסוימת לא משתתפת בעצירה, קח את זה בחשבון בהצעות.
- אל תמציא שעות פתיחה, מחירים או זמינות. אם אינך יודע, אמור זאת והצע איך לבדוק.
- אל תבטיח שביצעת הזמנה או שינוי בפועל — אתה מציע, המשתמש מאשר.`
}

/** Maps our message shape to Gemini's `contents`. */
const toContents = (messages) =>
  messages
    .filter((m) => m.text?.trim())
    .map((m) => ({
      role: m.role === 'me' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }))

/**
 * Streams a reply. Calls `onChunk(text)` for each delta and resolves with the
 * full text. Throws with a Hebrew message the UI can show as-is.
 */
export async function streamReply({ messages, system, signal, onChunk }) {
  const body = {
    contents: toContents(messages),
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
  }

  const url = PROXY
    ? PROXY
    : `${API}/models/${MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(KEY)}`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PROXY ? { ...body, model: MODEL } : body),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error('אין חיבור לשרת ה-AI. בדוק את החיבור לאינטרנט.')
  }

  if (!res.ok) throw new Error(await describeError(res))

  const reader = res.body?.getReader()
  if (!reader) throw new Error('התשובה מהשרת ריקה.')

  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let json
      try {
        json = JSON.parse(payload)
      } catch {
        continue // partial frame; the next read completes it
      }

      const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      if (text) {
        full += text
        onChunk?.(text)
      }
    }
  }

  if (!full.trim()) throw new Error('הסוכן לא החזיר תשובה. נסה לנסח מחדש.')
  return full
}

/** Turns an HTTP failure into something worth showing a user. */
async function describeError(res) {
  let detail = ''
  try {
    const data = await res.json()
    detail = data?.error?.message ?? ''
  } catch {
    /* non-JSON body */
  }

  if (res.status === 429) return 'חרגת ממכסת הבקשות החינמית. המתן דקה ונסה שוב.'
  if (res.status === 400 && /API key not valid/i.test(detail)) return 'מפתח ה-API אינו תקין.'
  if (res.status === 403) {
    return 'הבקשה נדחתה. בדוק שהמפתח מורשה לדומיין הזה ושה-Generative Language API מופעל.'
  }
  if (res.status === 404) {
    return `הדגם "${MODEL}" לא נמצא. הרץ \`npm run ai:check\` כדי לראות אילו דגמים זמינים למפתח שלך.`
  }
  return `שגיאה מה-AI (${res.status})${detail ? `: ${detail}` : ''}`
}
