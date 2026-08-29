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

const CATEGORY_IDS = Object.keys(CATEGORIES)

/** Maps the model's Hebrew category word onto one of our four pin types. */
function normaliseCategory(word = '') {
  const w = word.trim()
  if (/מוזיאון|גלריה|תערוכה/.test(w)) return 'museum'
  if (/מסעד|אוכל|קפה|בר|שוק/.test(w)) return 'food'
  if (/הליכ|טיול|פארק|גן|שיטוט/.test(w)) return 'walking'
  if (/אתר|מגדל|כנסי|ארמון|נוף|תצפית/.test(w)) return 'landmark'
  return CATEGORY_IDS.includes(w) ? w : 'landmark'
}

/**
 * @returns {Promise<{stops: Array, source: 'ai'|'fallback', warning?: string}>}
 */
export async function buildItinerary({ trip, families, already = [], signal }) {
  if (!hasAI) {
    return { stops: [], source: 'fallback', warning: 'סוכן ה-AI אינו מחובר' }
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
        'אתה מתכנן מסלולי טיול. החזר אך ורק שורות בפורמט:\n' +
        'שעה | כתובת מלאה באנגלית | שם המקום בעברית | קטגוריה | משפט תיאור קצר\n' +
        'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר.\n' +
        'הכתובת באנגלית חייבת להיות בפורמט "Place, City, Country" עם השם הרשמי ' +
        'שמופיע במפות — היא משמשת לחיפוש גיאוגרפי, ולכן שם העיר והמדינה באנגלית בלבד.\n' +
        'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 5 שורות, לפי סדר השעות.',
      prompt:
        `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` +
        `יום ${trip.day} מתוך ${trip.totalDays}\n` +
        `נוסעים: ${families.reduce((n, f) => n + f.members.length, 0)}\n` +
        `אופי הטיול: ${styleNames || 'כללי'}\n` +
        (already.length > 0
          ? `כבר מתוכננים בימים אחרים של אותו טיול — אל תציע אותם שוב: ${already.join(', ')}\n`
          : '') +
        '\nתכנן יום אחד, מ-09:00 עד הערב, עם מרחקי הליכה סבירים בין העצירות.',
    })

    const rows = parseRows(text, ['time', 'name', 'he', 'category', 'desc'])
    if (rows.length === 0) {
      return { stops: [], source: 'fallback', warning: 'לא הצלחתי לפענח את המסלול' }
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

    const dropped = located.length - stops.length

    return {
      stops,
      source: 'ai',
      warning: dropped > 0 ? `${dropped} עצירות לא אותרו על המפה והושמטו` : undefined,
    }
  } catch (err) {
    record({
      kind: 'ai',
      message: `יצירת מסלול נכשלה: ${err?.message ?? err}`,
      stack: err?.stack,
      context: { city: trip.city },
    })
    return { stops: [], source: 'fallback', warning: err?.message }
  } finally {
    done()
  }
}
