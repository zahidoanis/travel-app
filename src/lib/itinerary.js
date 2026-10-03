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

import { complete, parseRows, hasAI } from './gemini'
import { geocodeAll } from './geocode'
import { record, breadcrumb, watchdog } from './telemetry'
import { CATEGORIES, TRAVEL_STYLES } from '../data'
import { t } from '../i18n'

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
          ? `כבר מתוכננים בטיול הזה — אל תציע אותם שוב: ${avoid.join(', ')}\n` // i18n-ignore
          : '') +
        (instructions ? `הנחיות מפורשות מהמשתמש — חובה לכבד אותן: ${instructions}\n` : '') + // i18n-ignore
        // What the chat agent has learned about this group (REMEMBER lines).
        (memory.length ? `מה שידוע על הקבוצה — התחשב בזה: ${memory.map((m) => m.text).join('; ')}\n` : '') + // i18n-ignore
        (extra ||
          '\nתכנן יום אחד מלא, מ-09:00 עד הערב: לפחות 4 מקומות לביקור ועוד מקום לארוחת צהריים, ' + // i18n-ignore
          'עם מרחקי הליכה סבירים ביניהם. כל יום בטיול מתמקד באזור אחר של העיר או בטיול יום מחוצה לה.'), // i18n-ignore
    })

    const rows = parseRows(text, ['time', 'name', 'he', 'category', 'desc'])
    // The model returns a fully qualified English address, which Nominatim can
    // resolve on its own. Passing the Hebrew city as context instead finds
    // nothing — Nominatim matched 0 of 5 stops that way.
    const located = await geocodeAll(rows.map((r) => ({ ...r, query: r.name })), '')
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
        id: `d${trip.day}-${i + 1}`,
        // Display the place, not the whole "Place, City, Country" search string.
        name: r.name.split(',')[0].trim(),
        he: r.he || r.name,
        desc: r.desc,
        time: r.time,
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
