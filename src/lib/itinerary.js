/**
 * Builds a day's itinerary for whatever destination the user chose.
 *
 * Two stages on purpose:
 *   1. the model picks the places and the shape of the day
 *   2. Nominatim resolves each place to real coordinates
 *
 * Splitting it that way keeps the model doing what it is good at — knowing
 * that the Louvre pairs well with the Tuileries — and keeps it away from what
 * it is bad at, which is remembering exact latitudes.
 */

import { complete, parseRows, hasAI, clean } from './gemini'
import { geocodeAll } from './geocode'
import { record, breadcrumb, watchdog } from './telemetry'
import { CATEGORIES, TRAVEL_STYLES } from '../data'
import { t } from '../i18n'
import { newId } from './ids'
import { normTime } from './dates'

const CATEGORY_IDS = Object.keys(CATEGORIES)

/** Maps the model's category word — Hebrew or English, depending on the UI
 *  language it was asked to answer in — onto one of our four pin types. */
export function normaliseCategory(word = '') {
  const w = word.trim()
  if (/מוזיאון|גלריה|תערוכה|museum|galler|exhibit/i.test(w)) return 'museum' // i18n-ignore
  if (/מסעד|אוכל|קפה|בר|שוק|restaurant|food|caf|\bbar\b|market/i.test(w)) return 'food' // i18n-ignore
  if (/הליכ|טיול|פארק|גן|שיטוט|walk|hike|park|garden|stroll/i.test(w)) return 'walking' // i18n-ignore
  if (/אתר|מגדל|כנסי|ארמון|נוף|תצפית|sight|landmark|tower|church|cathedral|palace|view/i.test(w)) return 'landmark' // i18n-ignore
  return CATEGORY_IDS.includes(w) ? w : 'landmark'
}

/** A day never goes out with fewer stops than this. */
export const MIN_STOPS = 4

/** What the model is asked for — a buffer above MIN_STOPS, since a stop the
 *  geocoder can't place is dropped rather than put on the map at 0,0. */
const ASK_STOPS = 6

/**
 * @returns {Promise<{stops: Array, source: 'ai'|'fallback', warning?: string}>}
 */
export async function buildItinerary({ trip, families, already = [], instructions = '', memory = [], signal }) {
  if (!hasAI) {
    return { stops: [], source: 'fallback', warning: t('סוכן ה-AI אינו מחובר') }
  }

  breadcrumb('action', `generate itinerary for ${trip.city}`)
  const done = watchdog('itinerary.generate', 60000, { city: trip.city })

  const styleNames = TRAVEL_STYLES.filter((s) => trip.styles?.includes(s.id))
    .map((s) => s.title)
    .join(', ')

  // One request to the model, geocoded. `count` rows; `avoid` = places that
  // must not come back (other days, and this day's own stops on a retry).
  const ask = async (count, avoid, extra = '') => {
    const text = await complete({
      kind: 'plan',
      signal,
      system:
        'אתה מתכנן מסלולי טיול. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt; see gemini.js language override
        'שעה | כתובת מלאה באנגלית | שם המקום בעברית | קטגוריה | משפט תיאור קצר\n' + // i18n-ignore
        'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר.\n' + // i18n-ignore
        'הכתובת באנגלית חייבת להיות בפורמט "Place, City, Country" עם השם הרשמי ' + // i18n-ignore
        'שמופיע במפות — היא משמשת לחיפוש גיאוגרפי, ולכן שם העיר והמדינה באנגלית בלבד.\n' + // i18n-ignore
        `בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק ${count} שורות, לפי סדר השעות.`, // i18n-ignore
      prompt:
        `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore
        `יום ${trip.day} מתוך ${trip.totalDays}\n` + // i18n-ignore
        `נוסעים: ${families.reduce((n, f) => n + f.members.length, 0)}\n` + // i18n-ignore
        `אופי הטיול: ${styleNames || 'כללי'}\n` + // i18n-ignore
        (avoid.length > 0
          ? `כבר מתוכננים בטיול הזה — אל תציע אותם שוב: ${avoid.map((a) => clean(a, 80)).join(', ')}\n` // i18n-ignore
          : '') +
        (instructions ? `הנחיות מפורשות מהמשתמש — חובה לכבד אותן: ${instructions}\n` : '') + // i18n-ignore
        // What the chat agent has learned about this group (REMEMBER lines).
        (memory.length ? `מה שידוע על הקבוצה — התחשב בזה: ${memory.map((m) => clean(m.text, 200)).join('; ')}\n` : '') + // i18n-ignore
        (extra ||
          '\nתכנן יום אחד מלא, מ-09:00 עד הערב: לפחות 4 מקומות לביקור ועוד מקום לארוחת צהריים, ' + // i18n-ignore
          'עם מרחקי הליכה סבירים ביניהם. כל יום בטיול מתמקד באזור אחר של העיר או בטיול יום מחוצה לה.'), // i18n-ignore
    })

    const rows = parseRows(text, ['time', 'name', 'he', 'category', 'desc'])
    // The model returns a fully qualified English address, which Nominatim can
    // resolve on its own. Passing the Hebrew city as context instead finds
    // nothing — Nominatim matched 0 of 5 stops that way.
    const located = await geocodeAll(rows.map((r) => ({ ...r, query: r.name })), '', trip)
    return { rows: rows.length, placed: located.filter((r) => r.lat != null && r.lng != null) }
  }

  try {
    const first = await ask(ASK_STOPS, already)
    if (first.rows === 0) {
      return { stops: [], source: 'fallback', warning: t('לא הצלחתי לפענח את המסלול') }
    }
    let placed = first.placed
    let dropped = first.rows - first.placed.length

    // Fewer than four on the map: one more round for the rest, told what
    // this day already has so it fills the gaps instead of repeating.
    if (placed.length < MIN_STOPS) {
      const need = MIN_STOPS - placed.length + 1
      const have = placed.map((r) => `${r.time} ${r.he || r.name}`).join(', ') || 'כלום' // i18n-ignore — AI prompt
      const more = await ask(
        need,
        [...already, ...placed.map((r) => r.he || r.name)],
        `\nליום הזה כבר יש: ${have}. הצע ${need} מקומות נוספים, אמיתיים וקלים לאיתור במפה, ` + // i18n-ignore
          'בשעות שמשתלבות ביום ובאותו אזור.' // i18n-ignore
      )
      placed = [...placed, ...more.placed]
      dropped += more.rows - more.placed.length
    }

    const stops = placed
      .sort((x, y) => String(x.time).localeCompare(String(y.time)))
      .map((r, i) => ({
        // Not just `i + 1` — every day's stops were generated the same way,
        // so day 1's stop 3 and day 2's stop 3 shared the literal id 3, and
        // switching days left the map's carousel on the previous day's stop.
        // Unique per build, too: saving merges by id (lib/merge.js), and a
        // rebuilt day reusing "d3-1" read as the old first stop, edited.
        id: newId(`d${trip.day}-${i + 1}-`),
        // Display the place, not the whole "Place, City, Country" search string.
        name: r.name.split(',')[0].trim(),
        he: r.he || r.name,
        desc: r.desc,
        time: normTime(r.time) ?? r.time,
        cat: normaliseCategory(r.category),
        rating: null,
        lat: r.lat,
        lng: r.lng,
      }))

    return {
      stops,
      source: 'ai',
      warning: stops.length < MIN_STOPS && dropped > 0
        ? t('{n} עצירות לא אותרו על המפה והושמטו', { n: dropped })
        : undefined,
    }
  } catch (err) {
    record({
      kind: 'ai',
      message: `יצירת מסלול נכשלה: ${err?.message ?? err}`, // i18n-ignore — internal log
      stack: err?.stack,
      context: { city: trip.city },
    })
    return { stops: [], source: 'fallback', warning: err?.message }
  } finally {
    done()
  }
}

/**
 * Rows of "day | time | address | name | category | description", read
 * leniently — the model sometimes dresses them as a Markdown table (leading
 * and trailing pipes, a ---|--- rule), writes the time as 9.00, says "יום 2"
 * for the day, or leaves the description off. All of those are still a
 * usable row; none should cost the whole answer.
 */
function parseDayRows(text) {
  const rows = []
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, '').replace(/^\||\|$/g, '')
    if (!line.includes('|') || /^[\s|:-]+$/.test(line)) continue
    const c = line.split('|').map((x) => x.trim())
    if (c.length < 5) continue
    const day = Number(c[0].match(/\d+/)?.[0])
    const time = c[1].match(/^(\d{1,2})[:.](\d{2})$/)
    if (!day || !time) continue
    rows.push({
      day,
      time: `${time[1].padStart(2, '0')}:${time[2]}`,
      name: c[2],
      he: c[3],
      category: c[4],
      desc: c.slice(5).join(' | '),
    })
  }
  return rows
}

/** Days planned per request — see buildItineraryDays. */
export const DAYS_PER_REQUEST = 3

/**
 * Several days of one trip, asked for together.
 *
 * Planning day by day cost one model request per day (two when a day came
 * back short) — a 5-day trip was 5-10 of the 20 free requests a model gets
 * each day. Asked together the model sees the whole stretch at once: it
 * spreads neighbourhoods and day trips across the days instead of every day
 * starting from the same famous centre, and repeats nothing. A trip of 5
 * days is 2 requests.
 *
 * Whatever comes back short — a day under MIN_STOPS after the map lookup, or
 * missing from the answer entirely — is rebuilt on its own through
 * buildItinerary, so no day is ever shorter than a single-day plan would be.
 *
 * @returns {Promise<{days: Record<number, Array>, warning?: string}>}
 */
export async function buildItineraryDays({ trip, families, dayNums, already = [], instructions = '', memory = [], signal }) {
  if (!hasAI) return { days: {}, warning: t('סוכן ה-AI אינו מחובר') }

  breadcrumb('action', `generate ${dayNums.length} days for ${trip.city}`)
  const done = watchdog('itinerary.generate', 90000, { city: trip.city })

  const styleNames = TRAVEL_STYLES.filter((x) => trip.styles?.includes(x.id)).map((x) => x.title).join(', ')
  const list = dayNums.join(', ')
  const out = {}
  let warning

  try {
    const text = await complete({
      signal,
      kind: 'plan',
      maxTokens: 8192,
      system:
        'אתה מתכנן מסלולי טיול. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt; see gemini.js language override
        'מספר היום | שעה | כתובת מלאה באנגלית | שם המקום בעברית | קטגוריה | משפט תיאור קצר\n' + // i18n-ignore
        'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר.\n' + // i18n-ignore
        'הכתובת באנגלית חייבת להיות בפורמט "Place, City, Country" עם השם הרשמי ' + // i18n-ignore
        'שמופיע במפות — היא משמשת לחיפוש גיאוגרפי, ולכן שם העיר והמדינה באנגלית בלבד.\n' + // i18n-ignore
        `בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק ${ASK_STOPS} שורות לכל יום, לפי סדר הימים ואז לפי השעות.`, // i18n-ignore
      prompt:
        `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore
        `הטיול נמשך ${trip.totalDays} ימים. הימים לתכנון עכשיו (מספרי היום בעמודה הראשונה): ${list}\n` + // i18n-ignore
        `נוסעים: ${families.reduce((n, f) => n + f.members.length, 0)}\n` + // i18n-ignore
        `אופי הטיול: ${styleNames || 'כללי'}\n` + // i18n-ignore
        (already.length > 0 ? `כבר מתוכננים בימים אחרים — אל תציע אותם שוב: ${already.map((a) => clean(a, 80)).join(', ')}\n` : '') + // i18n-ignore
        (instructions ? `הנחיות מפורשות מהמשתמש — חובה לכבד אותן: ${instructions}\n` : '') + // i18n-ignore
        (memory.length ? `מה שידוע על הקבוצה — התחשב בזה: ${memory.map((m) => clean(m.text, 200)).join('; ')}\n` : '') + // i18n-ignore
        '\nתכנן כל יום מ-09:00 עד הערב: לפחות 4 מקומות לביקור ועוד מקום לארוחת צהריים, ' + // i18n-ignore
        'עם מרחקי הליכה סבירים בתוך היום. כל יום מתמקד באזור אחר בעיר או בטיול יום מחוצה לה, ' + // i18n-ignore
        'ושום מקום לא חוזר בשני ימים.', // i18n-ignore
    })

    const rows = parseDayRows(text).filter((r) => dayNums.includes(r.day))
    // Left for diagnosis: how many usable rows the answer really held.
    if (rows.length < dayNums.length * MIN_STOPS) {
      record({
        kind: 'ai', level: 'warn',
        message: `multi-day answer thin: ${rows.length} usable rows for days ${list}`, // i18n-ignore — internal log
        context: { city: trip.city, head: text.slice(0, 300) },
      })
    }

    const located = await geocodeAll(rows.map((r) => ({ ...r, query: r.name })), '', trip)

    for (const day of dayNums) {
      out[day] = located
        .filter((r) => r.day === day && r.lat != null && r.lng != null)
        .sort((a, b) => String(a.time).localeCompare(String(b.time)))
        .map((r, i) => ({
          id: newId(`d${day}-${i + 1}-`),
          name: r.name.split(',')[0].trim(),
          he: r.he || r.name,
          desc: r.desc,
          time: r.time,
          cat: normaliseCategory(r.category),
          rating: null,
          lat: r.lat,
          lng: r.lng,
        }))
    }
  } catch (err) {
    record({
      kind: 'ai',
      message: `יצירת מסלול נכשלה: ${err?.message ?? err}`, // i18n-ignore — internal log
      stack: err?.stack,
      context: { city: trip.city, days: list },
    })
    warning = err?.message
  } finally {
    done()
  }

  // Short or missing days: the single-day planner, which also tops up.
  const taken = [...already, ...Object.values(out).flat().map((x) => x.he || x.name)]
  for (const day of dayNums) {
    if ((out[day]?.length ?? 0) >= MIN_STOPS) continue
    const r = await buildItinerary({ trip: { ...trip, day }, families, already: taken, instructions, memory, signal })
    if ((r.stops?.length ?? 0) > (out[day]?.length ?? 0)) {
      out[day] = r.stops
      taken.push(...r.stops.map((x) => x.he || x.name))
    }
    warning = warning ?? r.warning
  }

  return { days: out, warning }
}
