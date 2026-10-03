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

import { t, lang } from '../i18n'

/**
 * The prompts in this file (and the other AI prompts in the app) are written
 * in Hebrew. Rather than maintain a second English copy of each, English mode
 * appends one directive to every request, in streamReply() below, that
 * overrides their language while leaving their machine formats alone.
 */
const LANGUAGE_OVERRIDE = lang === 'en'
  ? '\n\n---\nLANGUAGE OVERRIDE — this takes priority over any language instruction anywhere else in these instructions. ' +
    'The user\'s interface is in English. Write every human-readable word of your output in English: replies, place ' +
    'display names, areas, cuisines, price ranges, descriptions and categories — including any field or column the ' +
    'instructions say to write in Hebrew (עברית). Keep machine formats exactly as specified: action keywords ' + // i18n-ignore
    '(PLAN_DAYS, ADD_STOP, REMOVE_STOP, BOOKING_LINK, SUGGEST, REMEMBER), column order, the | separators, and HH:MM times. ' +
    'In the [[display name|Place, City, Country]] place syntax, write the display name in English too. ' +
    'For a category, use one of: museum, restaurant, walk, sight (or attraction, for a booking link).'
  : ''
const PROXY = import.meta.env?.VITE_AI_PROXY_URL ?? ''
const KEY = import.meta.env?.VITE_GEMINI_API_KEY ?? ''
const MODEL = import.meta.env?.VITE_GEMINI_MODEL ?? 'gemini-3.6-flash'

const API = 'https://generativelanguage.googleapis.com/v1beta'

export const hasAI = Boolean(PROXY || KEY)
export const aiMode = PROXY ? 'proxy' : KEY ? 'direct' : 'off'
export const aiModel = MODEL

// i18n-ignore-start — AI prompt text below; see LANGUAGE_OVERRIDE above.
/**
 * Formats the real reading `fetchTripWeather` (TripProvider.jsx) pulled for
 * this trip — a live Open-Meteo forecast, or a historical climate average
 * when the trip is too far out for one — as grounded context the model can
 * quote instead of guessing from training data. Undefined/null when no
 * weather question triggered a fetch, or the fetch found nothing.
 */
function weatherBlock(weather) {
  if (!weather) return ''

  if (weather.kind === 'forecast') {
    const days = (weather.days ?? [])
      .slice(0, 7)
      .map((d) => `${d.date}: ${d.icon} ${d.tempMax}°/${d.tempMin}°`)
      .join(' · ')
    return `

מזג אוויר אמיתי ב${weather.city} (תחזית חיה, Open-Meteo) — עכשיו: ${weather.now.icon} ${weather.now.tempC}°C${weather.now.localTime ? `, והשעה שם עכשיו ${weather.now.localTime}` : ''}. השבוע הקרוב: ${days}.
זה מידע אמיתי ועדכני, לא ניחוש — מותר ורצוי להשתמש בו כשעונים על שאלות מזג אוויר על הטיול הזה, ואסור לומר שאין לך גישה למזג האוויר.`
  }

  if (weather.kind === 'climate') {
    return `

מזג אוויר: הטיול רחוק מדי לתחזית חיה, אז הנה ממוצע אקלים אמיתי (Open-Meteo, ממוצע ${weather.years} השנים האחרונות באותם תאריכים בערך) ב${weather.city}: ${weather.tempMax}°/${weather.tempMin}°C, כ-${weather.rainChance}% סיכוי לגשם.
זה מידע אמיתי, לא ניחוש — אפשר ורצוי להשתמש בו, אבל ציין בקצרה שזה ממוצע היסטורי ולא תחזית מדויקת לתאריך הספציפי, ושכדאי לבדוק תחזית עדכנית קרוב למועד.`
  }

  return ''
}

/**
 * Where the trip is in time, said plainly. "היום: יום 1 מתוך 5" alone read
 * as "you're there now" — the opener wished a trip 17 days out a good first
 * day.
 */
function tripPhase(trip) {
  const day = (iso) => {
    if (!iso) return null
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const from = day(trip.from)
  const to = day(trip.to)
  if (!from) return `היום הפתוח בתכנון: יום ${trip.day} מתוך ${trip.totalDays}.`
  const until = Math.round((from - today) / 86400000)
  if (until > 0) {
    return `הטיול עוד לא התחיל: הוא מתחיל בעוד ${until} ${until === 1 ? 'יום' : 'ימים'} (${trip.from}) ונמשך ${trip.totalDays} ימים. המשתמש מתכנן מראש — הוא עדיין לא שם, אז אל תדבר כאילו הוא כבר בטיול. היום הפתוח בתכנון: יום ${trip.day}.`
  }
  if (to && to < today) return `הטיול כבר הסתיים (${trip.from} עד ${trip.to}).`
  return `הטיול מתרחש עכשיו. היום: יום ${trip.day} מתוך ${trip.totalDays}.`
}

/** Builds the agent's standing instructions, grounded in the actual trip. */
export function systemPrompt({ trip, stops, days = {}, families, memory = [], weather, userTime }) {
  const line = (s, i) => `${i + 1}. ${s.time} — ${s.he}${s.desc ? ` (${s.desc})` : ''}`
  const itinerary = stops.map(line).join('\n') || 'ריק'

  // Every day, not just the open one — "add it to day 3" or "replan without
  // restaurants" is unanswerable if the agent can only see today.
  const allDays = Array.from({ length: trip.totalDays }, (_, i) => i + 1)
    .map((d) => {
      const list = days[d] ?? []
      return `יום ${d}: ${list.length ? list.map((s) => `${s.time} ${s.he}`).join(' · ') : 'ריק'}`
    })
    .join('\n')

  // Ages are optional and only ever entered for a "kids" trip — worth
  // telling the agent when they exist, so it can actually pace and pick
  // activities by age instead of just knowing headcount. No names to go
  // with them — onboarding only ever collects a headcount now.
  const parties = families
    .map((f) => {
      const ages = f.members.map((m) => m.age).filter(Boolean).join(', ')
      return `- ${f.name || 'הנוסעים'}: ${f.members.length} נוסעים${ages ? ` — גילאי ילדים: ${ages}` : ''}${f.joined ? '' : ' (טרם הצטרפו)'}`
    })
    .join('\n')

  return `אתה סוכן הנסיעות של TripAI. אתה עוזר לקבוצה שמטיילת ב${trip.city}, ${trip.country}.

${tripPhase(trip)}
${userTime ? `השעה אצל המשתמש עכשיו: ${userTime} (לפי השעון במכשיר שלו). כשמברכים "בוקר טוב" / "ערב טוב" — לפי השעה הזו, לא לפי ניחוש.
` : ''}
הלו"ז של היום הפתוח:
${itinerary}

כל ימי הטיול:
${allDays}

הקבוצה:
${parties}

מה שאתה כבר יודע על הקבוצה (נשמר משיחות קודמות — התחשב בזה בכל המלצה, ואל תשאל על זה שוב):
${memory.length ? memory.map((m) => `- ${m.text}`).join('\n') : 'עדיין כלום.'}
${weatherBlock(weather)}

האופי שלך:
אתה חבר מקומי שמכיר את העיר מבפנים ושמח בשבילם על הטיול — לא מוקד שירות. חם, נלהב, עם פרט אחד חי שעושה חשק (האור, הריח, הרגע הנכון להגיע), אבל תמיד קונקרטי ומועיל. בלי "ניתן", "יש באפשרותכם" ושאר שפה של טופס; דבר כמו שמדברים. אימוג'י אחד לכל היותר בתשובה, ורק כשהוא מוסיף.

כללי עבודה:
- ענה תמיד בעברית, בגוף שני. טקסט רגיל בלבד — בלי כוכביות, בלי markdown, בלי כותרות.
- היה קצר. 2-4 משפטים אלא אם ביקשו פירוט.
- כשמבקשים ממך הצעה, תן אפשרות קונקרטית אחת או שתיים עם שעות ומקומות, לא רשימה ארוכה, ואל תשנה כלום בלו"ז עד שהמשתמש מאשר.
- נהל שיחה, אל תהיה רק מכונת תשובות. כשהבקשה פתוחה או שחסר פרט שבאמת משנה את ההמלצה (תקציב, קצב, סוג אוכל, מי מצטרף, איזה יום) — שאל שאלה ממוקדת אחת לפני שאתה ממליץ, או תן המלצה קצרה ושאל שאלה אחת שתעזור לדייק. אל תשאל יותר משאלה אחת בכל תשובה, ואל תשאל על מה שכבר ידוע לך מהלו"ז או מהשיחה.
- אחרי שהצעת מקום, הצע את הצעד הבא: באיזה יום הוא יתאים, או אם לחפש חלופה.

מקומות — חובה:
כל מקום ספציפי שאתה מזכיר (אתר, מסעדה, בית קפה, מוזיאון, פארק, שכונה, נקודת תצפית, חנות) כתוב בתחביר [[שם לתצוגה|Place, City, Country]]. החלק הראשון הוא השם שהמשתמש יראה, בשפת התשובה. החלק השני הוא השם באנגלית כפי שהוא מופיע במפות, עם העיר והמדינה — הוא משמש לאיתור המקום על המפה. למסעדות, בתי קפה, ברים וחנויות הוסף גם את שם הרחוב, כי לשם קצר יש לרוב כמה מקומות דומים: Place, Street, City, Country. האפליקציה הופכת את זה לקישור שפותח את המקום על מפה ומאפשר להוסיף אותו ליום. דוגמה: כדאי לקפוץ ל[[פסטייש דה בלם|Pastéis de Belém, Lisbon, Portugal]] אחרי המגדל. אל תשתמש בתחביר הזה בתוך שורות פעולה, ולא לדברים שאינם מקום מסוים (למשל "מסעדה טובה" או "העיר העתיקה" באופן כללי).

קישורים — חובה:
סיור, כרטיס או פעילות שאפשר להזמין (למשל מתוצאות Viator) הם לא מקום על המפה — לעולם אל תכתוב אותם בתחביר [[...]]. כתוב אותם כקישור בפורמט [שם הסיור](הקישור המלא), כשהקישור בלי רווחים. אף פעם אל תכתוב כתובת אינטרנט חשופה בתוך הטקסט — תמיד בפורמט [טקסט](קישור).

שאלות המשך — חובה:
בסוף כל תשובה רגילה (לא כשאתה כותב שורות פעולה), הוסף שורה אחרונה אחת בדיוק בפורמט:
SUGGEST: <המשך 1> | <המשך 2> | <המשך 3>
2 או 3 המשכים קצרים (עד 7 מילים כל אחד), מנוסחים כאילו המשתמש כותב אותם, שמקדמים את התכנון מהנקודה הנוכחית בשיחה. אם שאלת שאלה — ההמשכים יכולים להיות תשובות אפשריות לה. דוגמה: SUGGEST: הוסף את זה ליום 2 | משהו זול יותר | מה יש בסביבה לילדים?
- אל תמציא שעות פתיחה, מחירים או זמינות. אם אינך יודע, אמור זאת והצע איך לבדוק.
- אל תבטיח שביצעת הזמנה אמיתית (מסעדה, כרטיס, וכו') — זה תמיד רק הצעה. כשמבקשים ממך להזמין או לשריין מקום בפועל — אתה לא יכול לבצע את זה, אבל תוכל להכין קישור אמיתי לחיפוש ולהזמנה עם שורת הפעולה BOOKING_LINK במקום סתם לסרב.
- אין לך שום כלי, פונקציה, tool או API לקריאה בזמן אמת — גם לא חיפוש אינטרנט — מלבד שורות הפעולה המפורטות למטה. אסור לך בשום מקרה לפלוט קריאת פונקציה או תחביר כלי כלשהו, גם אם נדמה לך שזה היה עוזר לענות טוב יותר. תמיד ותמיד תשיב בטקסט חופשי רגיל בלבד. אם המשתמש מבקש ממך "לבדוק באתר" או "לחפש באינטרנט" ולא סופק לך מידע חיצוני עדכני כאן בהוראות המערכת — פשוט אמור בכנות שאין לך גישה לבדוק את זה בזמן אמת, על סמך הידע הכללי שלך בלבד.

איך משנים את הלו"ז בפועל — זה החוק החשוב ביותר:
הלו"ז משתנה אך ורק אם אתה כותב שורת פעולה מהרשימה למטה, כל שורה בפני עצמה, בתחילת שורה. האפליקציה מבצעת אותה ומדווחת למשתמש בעצמה מה הצליח ומה לא. בלי שורת פעולה — שום דבר לא השתנה, ולכן אסור לך לכתוב "הוספתי", "עדכנתי", "בניתי" או כל ניסוח דומה. אם המשתמש רק שואל או מבקש הצעה — ענה בטקסט בלבד, בלי שורת פעולה. כשאתה כותב שורות פעולה, אל תוסיף טקסט אישור משלך.

שורות הפעולה:
PLAN_DAYS: <ימים מופרדים בפסיק> | <הנחיות אופציונליות>
  בונה מחדש את כל היום. רק כשביקשו במפורש לתכנן/לבנות/להחליף יום שלם. דוגמה: PLAN_DAYS: 1,2 | בלי מסעדות, עם ילדים
ADD_STOP: <יום> | <שעה HH:MM> | <שם המקום באנגלית בפורמט "Place, City, Country"> | <שם בעברית> | <קטגוריה: מוזיאון/מסעדה/הליכה/אתר> | <משפט תיאור>
  מוסיף עצירה אחת. דוגמה: ADD_STOP: 1 | 12:00 | Prague Astronomical Clock, Prague, Czechia | השעון האסטרונומי | אתר | שעון היסטורי מהמאה ה-15
REMOVE_STOP: <יום> | <שם העצירה כפי שמופיע בלו"ז>
  מסיר עצירה. דוגמה: REMOVE_STOP: 1 | השעון האסטרונומי
BOOKING_LINK: <שם המקום באנגלית בפורמט "Place, City, Country"> | <שם בעברית> | <קטגוריה: מסעדה/אטרקציה>
  מכין קישור אמיתי לחיפוש ולהזמנה של מסעדה או אטרקציה — לא מבצע הזמנה בפועל, רק מכין קישור. השתמש בזה כשמבקשים ממך "תזמין", "תשריין" או "תבדוק זמינות" למקום קונקרטי. דוגמה: BOOKING_LINK: Le Jules Verne, Paris, France | לה ז'ול ורן | מסעדה
כשמבקשים "הוסף את X" או "עדכן בהתאם" אחרי שהצעת משהו — כתוב את שורות ה-ADD_STOP/REMOVE_STOP המתאימות, ועדיף אותן על PLAN_DAYS כדי לא לדרוס את מה שכבר מתוכנן.

זיכרון:
REMEMBER: <עובדה קצרה, בגוף שלישי>
  כשהמשתמש מספר משהו קבוע ושימושי על הקבוצה — תזונה ואלרגיות, גילאים, מגבלות ניידות, תקציב, קצב, תחומי עניין, דברים שלא אוהבים — כתוב שורה כזו כדי שתזכור את זה גם בשיחות הבאות. לא לבקשות חד-פעמיות ("היום בא לנו פיצה"), ולא למה שכבר מופיע ברשימת מה שאתה יודע. דוגמה: REMEMBER: צמחוניים, אוכלים דגים
  שורת REMEMBER היא היחידה שמותר לכתוב יחד עם תשובה רגילה ועם שורת SUGGEST — ענה כרגיל, ואפשר לציין בחום שלקחת את זה לתשומת לבך.`
}
// i18n-ignore-end

// i18n-ignore-start — AI prompt text.
/**
 * Sent, unseen, as the user's turn when the chat opens on an empty thread,
 * so the agent speaks first — about this trip, today, and the weather —
 * instead of the user facing a blank screen and four generic buttons.
 */
export const OPENER_PROMPT =
  '(הודעת מערכת, לא מהמשתמש: המשתמש פתח עכשיו את הצ\'אט. פתח אתה את השיחה. ' +
  'ברכה קצרה שמתאימה לשעה אצל המשתמש (היא מופיעה בהוראות), ואז התייחסות קונקרטית אחת למצב שלהם עכשיו — ' +
  'מה מחכה היום או בעצירה הבאה, מזג האוויר אם הוא משנה משהו, או יום ריק שכדאי למלא — ' +
  'והצעה יזומה אחת או שאלה אחת. 2-3 משפטים, חם ואישי. אל תציג את עצמך ואל תפרט מה אתה יודע לעשות. ' +
  'בסוף שורת SUGGEST כרגיל.)'
// i18n-ignore-end

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
 * full text. Throws with a message (in the UI's language) the UI can show as-is.
 */
export async function streamReply({ messages, system, searchContext, signal, onChunk, onFrame, fast = false, grounding = null }) {
  const body = {
    contents: toContents(messages),
    systemInstruction: { parts: [{ text: system + LANGUAGE_OVERRIDE }] },
    generationConfig: {
      temperature: 0.7,
      // Thinking tokens count against this budget. At 2048, Gemini 3's
      // ~1,300-1,500 thinking tokens left so little room that answers came
      // back cut off or empty — a day's plan "couldn't be parsed", an
      // import's enrichment stopped after 13 of 24 stops.
      maxOutputTokens: 4096,
      // Structured jobs (a day's stops, hotel or restaurant rows) don't need
      // the model to deliberate first: measured on a day of Rome, minimal
      // thinking answered in ~5s with all 6 rows, vs 8-21s by default. The
      // chat keeps full thinking — that's where the reasoning shows.
      ...(fast ? { thinkingConfig: { thinkingLevel: 'minimal' } } : {}),
    },
    // Direct mode only — Google's API takes the tool itself. The proxy gets
    // a plain flag instead (below) and attaches the tool on its side.
    ...(grounding && !PROXY
      ? {
          tools: [{ googleMaps: {} }],
          ...(grounding.latLng ? { toolConfig: { retrievalConfig: { latLng: grounding.latLng } } } : {}),
        }
      : {}),
  }

  const url = PROXY
    ? PROXY
    : `${API}/models/${MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(KEY)}`

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `model` and `searchContext` are proxy-only extensions — Google's own
      // API validates the request shape strictly and would 400 on either in
      // direct mode.
      body: JSON.stringify(
        PROXY
          ? {
              ...body,
              model: MODEL,
              ...(searchContext ? { searchContext } : {}),
              ...(grounding ? { grounding: 'maps', ...(grounding.latLng ? { latLng: grounding.latLng } : {}) } : {}),
            }
          : body
      ),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new Error(t('אין חיבור לשרת ה-AI. בדוק את החיבור לאינטרנט.'))
  }

  // A model that doesn't take thinkingLevel (a fallback model, say) rejects
  // the whole request — ask again the ordinary way rather than fail.
  if (!res.ok && fast && res.status === 400) {
    return streamReply({ messages, system, searchContext, signal, onChunk, onFrame, grounding, fast: false })
  }
  if (!res.ok) throw new Error(await describeError(res))

  const reader = res.body?.getReader()
  if (!reader) throw new Error(t('התשובה מהשרת ריקה.'))

  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const emit = (frame) => {
    const json = frameJson(frame)
    if (!json) return
    onFrame?.(json)
    const text = textOf(json)
    if (!text) return
    full += text
    onChunk?.(text)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Google delimits frames with CRLFCRLF, so splitting on "\n\n" alone
    // matches nothing and swallows the entire stream after the first frame.
    const frames = buffer.split(SEP)
    buffer = frames.pop() ?? ''
    frames.forEach(emit)
  }

  // The final frame usually arrives without a trailing blank line.
  buffer += decoder.decode()
  if (buffer.trim()) emit(buffer)

  if (!full.trim()) throw new Error(t('הסוכן לא החזיר תשובה. נסה לנסח מחדש.'))
  return full
}

/**
 * One-shot completion: same transport, but collects the whole answer instead
 * of streaming it. For places that need the full text before they can render,
 * like parsing a list of suggestions.
 */
export function complete({ prompt, system, signal, fast = true }) {
  return streamReply({
    messages: [{ role: 'me', text: prompt }],
    system,
    signal,
    fast,
  })
}

const CURRENCY = { EUR: '€', USD: '$', GBP: '£', ILS: '₪', JPY: '¥' }

/**
 * Grounding with Google Maps: the model answers from real Maps data, and
 * every place it used comes back in the response's groundingMetadata — with
 * Google's own rating, review count, price range and address. Those are
 * read from there, not from what the model wrote, so a number on screen is
 * Google's, never the model's.
 *
 * Free: the proxy's keys are free-tier keys with no billing, so this can't
 * be charged for — a spent quota fails the request (and the caller falls
 * back to the ungrounded list, without ratings). Verified 2026-10-03 on a
 * Paris restaurant list.
 *
 * @returns {Promise<{ text: string, places: Array<{ title, uri, placeId,
 *   rating, reviews, price, address }> }>}
 */
export async function completeWithMaps({ prompt, system, latLng, signal }, attempt = 1) {
  const frames = []
  const text = await streamReply({
    messages: [{ role: 'me', text: prompt }],
    system,
    signal,
    grounding: { latLng },
    onFrame: (j) => frames.push(j),
  })

  // Whether to actually look in Maps is the model's call, and about one
  // answer in four came back from its own memory with no Maps data at all
  // (measured on the free-tier model, 2026-10-03). One more try.
  const used = frames.some((f) => f.candidates?.[0]?.groundingMetadata?.groundingChunks?.length)
  if (!used && attempt < 2) return completeWithMaps({ prompt, system, latLng, signal }, attempt + 1)

  const places = []
  for (const f of frames) {
    for (const chunk of f.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
      const m = chunk.maps
      // "Review of X" chunks are single reviews of a place already listed.
      if (!m?.title || /^review of /i.test(m.title)) continue
      if (places.some((x) => (m.placeId && x.placeId === m.placeId) || x.uri === m.uri)) continue
      const field = (name) => m.text?.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]+)`))?.[1]?.trim() ?? null
      const r = field('Rating')?.match(/([\d.]+)\s*\((\d[\d,]*)/)
      const price = field('Price Range')?.replace(/^([A-Z]{3})_/, (_, c) => CURRENCY[c] ?? `${c} `).replace('-', '–') ?? null
      places.push({
        title: m.title.replace(/\s*-\s*Google Maps$/i, '').trim(),
        uri: m.uri,
        placeId: m.placeId ?? null,
        rating: r ? Number(r[1]) : null,
        reviews: r ? Number(r[2].replace(/,/g, '')) : null,
        price,
        address: field('Address'),
      })
    }
  }
  return { text, places }
}

/**
 * Parses `name | area | price | reason` lines.
 *
 * A delimited line format rather than JSON on purpose: a model that drifts
 * produces one unusable row here, whereas a single stray character makes a
 * whole JSON document unparseable.
 */
export function parseRows(text, columns) {
  return text
    .split('\n')
    // Strip a list marker only when it is followed by whitespace. A bare
    // `[\d.)]+` class also eats the leading digits of real content — it turned
    // every "09:00" into ":00".
    .map((line) => line.trim().replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, ''))
    .filter((line) => line.includes('|'))
    .map((line) => line.split('|').map((c) => c.trim()))
    .filter((cells) => cells.length >= columns.length && cells[0])
    .map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ''])))
}

const SEP = /\r?\n\r?\n/

/** One SSE frame's JSON, or null for a partial or non-data frame. */
function frameJson(frame) {
  const line = frame.split(/\r?\n/).find((l) => l.startsWith('data:'))
  if (!line) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    return JSON.parse(payload)
  } catch {
    return null // partial frame; the next read completes it
  }
}

/** Pulls the visible text out of one frame, dropping reasoning parts. */
function textOf(json) {
  // Thinking models emit `thought` parts alongside the answer — those are
  // internal reasoning and must never reach the chat bubble.
  return (json?.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join('')
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

  if (res.status === 429) return t('חרגת ממכסת הבקשות החינמית. המתן דקה ונסה שוב.')
  if (res.status === 400 && /API key not valid/i.test(detail)) return t('מפתח ה-API אינו תקין.')
  if (res.status === 403) {
    return t('הבקשה נדחתה. בדוק שהמפתח מורשה לדומיין הזה ושה-Generative Language API מופעל.')
  }
  if (res.status === 404) {
    return t('הדגם "{model}" לא נמצא. הרץ `npm run ai:check` כדי לראות אילו דגמים זמינים למפתח שלך.', { model: MODEL })
  }
  return `${t('שגיאה מה-AI ({status})', { status: res.status })}${detail ? `: ${detail}` : ''}`
}
