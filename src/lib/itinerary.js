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

/**
 * @returns {Promise<{stops: Array, source: 'ai'|'fallback', warning?: string}>}
 */
export async function buildItinerary({ trip, families, already = [], instructions = '', memory = [], signal }) {
  if (!hasAI) {
    return { stops: [], source: 'fallback', warning: t('סוכן ה-AI אינו מחובר') }
  }

  breadcrumb('action', `generate itinerary for ${trip.city}`)
  const done = watchdog('itinerary.generate', 40000, { city: trip.city })

  const styleNames = TRAVEL_STYLES.filter((s) => trip.styles?.includes(s.id))
    .map((s) => s.title)
    .join(', ')

  try {
    const text = await complete({
      signal,
      system:
        'אתה מתכנן מסלולי טיול. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt; see gemini.js language override
        'שעה | כתובת מלאה באנגלית | שם המקום בעברית | קטגוריה | משפט תיאור קצר\n' + // i18n-ignore
        'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר.\n' + // i18n-ignore
        'הכתובת באנגלית חייבת להיות בפורמט "Place, City, Country" עם השם הרשמי ' + // i18n-ignore
        'שמופיע במפות — היא משמשת לחיפוש גיאוגרפי, ולכן שם העיר והמדינה באנגלית בלבד.\n' + // i18n-ignore
        'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 5 שורות, לפי סדר השעות.', // i18n-ignore
      prompt:
        `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore
        `יום ${trip.day} מתוך ${trip.totalDays}\n` + // i18n-ignore
        `נוסעים: ${families.reduce((n, f) => n + f.members.length, 0)}\n` + // i18n-ignore
        `אופי הטיול: ${styleNames || 'כללי'}\n` + // i18n-ignore
        (already.length > 0
          ? `כבר מתוכננים בימים אחרים של אותו טיול — אל תציע אותם שוב: ${already.map((a) => clean(a, 80)).join(', ')}\n` // i18n-ignore
          : '') +
        (instructions ? `הנחיות מפורשות מהמשתמש — חובה לכבד אותן: ${instructions}\n` : '') + // i18n-ignore
        // What the chat agent has learned about this group (REMEMBER lines).
        (memory.length ? `מה שידוע על הקבוצה — התחשב בזה: ${memory.map((m) => clean(m.text, 200)).join('; ')}\n` : '') + // i18n-ignore
        '\nתכנן יום אחד, מ-09:00 עד הערב, עם מרחקי הליכה סבירים בין העצירות.', // i18n-ignore
    })

    const rows = parseRows(text, ['time', 'name', 'he', 'category', 'desc'])
    if (rows.length === 0) {
      return { stops: [], source: 'fallback', warning: t('לא הצלחתי לפענח את המסלול') }
    }

    // The model returns a fully qualified English address, which Nominatim can
    // resolve on its own. Passing the Hebrew city as context instead finds
    // nothing — Nominatim matched 0 of 5 stops that way.
    const located = await geocodeAll(
      rows.map((r) => ({ ...r, query: r.name })),
      ''
    )

    const stops = located
      .filter((r) => r.lat != null && r.lng != null)
      .map((r, i) => ({
        // Not just `i + 1` — every day's stops were generated the same way,
        // so day 1's stop 3 and day 2's stop 3 shared the literal id 3.
        // Switching days on the map screen looked like it worked (the pins
        // moved, since MapCanvas draws from the whole stops array either
        // way) but the "which stop is active" state didn't actually change
        // — the old id still matched something in the new day's list — so
        // the bottom card carousel kept showing the previous day's stop.
        // Unique per build, too: saving merges by id (lib/merge.js), and a
        // rebuilt day reusing "d3-1" read as the old first stop, edited.
        id: newId(`d${trip.day}-${i + 1}-`),
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

    const dropped = located.length - stops.length

    return {
      stops,
      source: 'ai',
      warning: dropped > 0 ? t('{n} עצירות לא אותרו על המפה והושמטו', { n: dropped }) : undefined,
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
