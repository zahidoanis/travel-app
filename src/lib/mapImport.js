/**
 * Imports a trip someone already planned in Google Maps.
 *
 * The Worker (/mymap) does the fetching — Google's KML export has no CORS —
 * and returns layers of places. This file turns those layers into what the
 * app thinks in: a destination, a date range, a hotel, and a list of days.
 *
 * Built against a real My Maps trip (Lisbon, 5 layers): one layer per day
 * named with its date ("יום שישי 19.12"), the hotel repeated as the first
 * stop of every day, one layer left with Google's default "Directions from…"
 * name, and one small extra layer that duplicated a stop from another day.
 * Each of those shapes is handled below rather than assumed away.
 */

import { complete, parseRows, hasAI } from './gemini'
import { geocodeAll } from './geocode'
import { normaliseCategory } from './itinerary'
import { CITIES } from '../cities'
import { record } from './telemetry'
import { t } from '../i18n'

const PROXY = import.meta.env?.VITE_AI_PROXY_URL ?? ''

/** @returns {Promise<{kind, title, layers: Array<{name, places}>}>} throws with a UI-ready message */
export async function fetchGoogleMap(link) {
  if (!PROXY) throw new Error(t('הייבוא דורש חיבור לשרת, שאינו מוגדר כאן.'))
  let res
  try {
    res = await fetch(`${PROXY.replace(/\/$/, '')}/mymap?url=${encodeURIComponent(link.trim())}`)
  } catch {
    throw new Error(t('אין חיבור לשרת. בדוק את החיבור לאינטרנט.'))
  }
  const body = await res.json().catch(() => ({}))
  if (res.ok) return body

  const messages = {
    'bad-url': t('זה לא נראה כמו קישור. העתק את הקישור המלא מ-Google Maps.'),
    'not-google': t('זה לא קישור של Google Maps.'),
    'private-or-missing': t('המפה פרטית או לא קיימת. ב-My Maps לחץ "שיתוף" והגדר "כל מי שיש לו את הקישור".'),
    unsupported: t('את סוג הקישור הזה אי אפשר לייבא. עובד עם מפות My Maps ועם מסלולי ניווט (Directions).'),
    empty: t('לא נמצאו מקומות במפה הזו.'),
  }
  throw new Error(messages[body.error] ?? t('הייבוא נכשל. נסה שוב.'))
}

/* ---------- geometry ---------- */

const metres = (a, b) => {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.sqrt(x * x + y * y) * 6371000
}
const hasPos = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
const near = (a, b, m) => hasPos(a) && hasPos(b) && metres(a, b) < m

/* ---------- reading the layers ---------- */

const LODGING = /hotel|hostel|apartment|airbnb|guest ?house|b&b|residence|suites|מלון|אכסניה|דירה/i // i18n-ignore — matches place names

/**
 * The place the trip keeps returning to. A hotel is the one stop that shows
 * up in most layers (it's where every day starts or ends); a lodging-looking
 * name in at least two layers also counts.
 */
function findHotel(layers) {
  const seen = []
  for (const layer of layers) {
    const inLayer = new Set()
    for (const p of layer.places) {
      let hit = seen.find((s) => near(s.place, p, 150))
      if (!hit) seen.push((hit = { place: p, layers: 0 }))
      if (!inLayer.has(hit)) { inLayer.add(hit); hit.layers++ }
    }
  }
  const need = Math.max(2, Math.ceil(layers.length / 2))
  return (
    seen.filter((s) => s.layers >= need).sort((a, b) => b.layers - a.layers)[0]?.place ??
    seen.find((s) => s.layers >= 2 && LODGING.test(s.place.name))?.place ??
    null
  )
}

/** "19.12", "19/12/2025", "21.12 סינטרה" -> ISO date, or null. */
function dateOf(name, fallbackYear) {
  const m = name.match(/(?:^|\D)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/)
  if (!m) return null
  const [day, month] = [Number(m[1]), Number(m[2])]
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : fallbackYear
  if (!year) {
    // No year anywhere: the next time that date comes around.
    const now = new Date()
    year = now.getFullYear()
    if (new Date(Date.UTC(year, month - 1, day)) < new Date(Date.UTC(year, now.getMonth(), now.getDate()))) year++
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The city most places sit in, read off Google's own addresses
 * ("Rossio Square, Lisbon, Portugal"): the second-to-last part is the city,
 * the last the country. Postal codes ("1100-202 Lisboa") are stripped.
 */
function findCity(places) {
  const tally = new Map()
  for (const p of places) {
    const parts = p.name.split(',').map((s) => s.trim())
    if (parts.length < 3) continue
    const city = parts.at(-2).replace(/^[\d\s-]+/, '').trim()
    const country = parts.at(-1)
    if (!city || /\d/.test(city)) continue
    const key = `${city}|${country}`
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!top) return null
  const [cityEn, countryEn] = top.split('|')
  const known = CITIES.find((c) => c.en.toLowerCase() === cityEn.toLowerCase())
  return { cityEn, countryEn, known }
}

/**
 * Layers -> the trip shape onboarding needs. Pure and synchronous, so the
 * preview can show exactly what will be created before anything is saved.
 *
 * @returns {{ title, destination, destinationEn, country, lat, lng, from, to,
 *             hotel, days: Array<{ date: string|null, label: string, places }> }}
 */
export function planFromMap(data, uiLang = 'he') {
  const layers = data.layers.filter((l) => l.places.length > 0)
  const hotel = findHotel(layers)
  const notHotel = (p) => !(hotel && near(hotel, p, 150))

  const year = Number(data.title?.match(/\b(20\d\d)\b/)?.[1]) || null
  const dated = []
  const undated = []
  for (const layer of layers) {
    const places = layer.places.filter(notHotel)
    if (places.length === 0) continue
    const date = dateOf(layer.name, year)
    ;(date ? dated : undated).push({ date, label: layer.name, places })
  }
  dated.sort((a, b) => a.date.localeCompare(b.date))

  // Two layers on the same date are one day.
  const days = []
  for (const d of dated) {
    const same = days.find((x) => x.date === d.date)
    if (same) same.places.push(...d.places)
    else days.push({ ...d })
  }

  // Undated layers ("Directions from…") fill the free dates inside the
  // trip, in the order they appear; with no dates at all they simply become
  // days 1, 2, 3…
  const free = []
  if (days.length > 0) {
    for (let d = days[0].date; d <= days.at(-1).date; d = addDays(d, 1)) {
      if (!days.some((x) => x.date === d)) free.push(d)
    }
  }
  const leftovers = []
  for (const layer of undated) {
    if (days.length === 0) days.push({ ...layer })
    else if (free.length > 0) days.push({ ...layer, date: free.shift() })
    else leftovers.push(layer)
  }
  days.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0))

  // With no free date left, an extra layer's stops join the lightest day —
  // minus anything already planned elsewhere (the Lisbon map's separate
  // "route to the aquarium" layer was the aquarium stop, again).
  for (const layer of leftovers) {
    const all = days.flatMap((d) => d.places)
    const fresh = layer.places.filter((p) => !all.some((q) => near(p, q, 300)))
    if (fresh.length === 0) continue
    days.reduce((a, b) => (b.places.length < a.places.length ? b : a)).places.push(...fresh)
  }

  const city = findCity(layers.flatMap((l) => l.places))
  const withPos = layers.flatMap((l) => l.places).filter(hasPos)
  const centre = withPos.length
    ? { lat: withPos.reduce((s, p) => s + p.lat, 0) / withPos.length, lng: withPos.reduce((s, p) => s + p.lng, 0) / withPos.length }
    : { lat: null, lng: null }

  const hebrew = uiLang !== 'en'
  return {
    title: data.title || '',
    destination: city ? (city.known ? (hebrew ? city.known.he : city.known.en) : city.cityEn) : '',
    destinationEn: city?.known?.en ?? city?.cityEn ?? '',
    country: city ? (city.known ? (hebrew ? city.known.country : city.known.countryEn) : city.countryEn) : '',
    lat: city?.known?.lat ?? centre.lat,
    lng: city?.known?.lng ?? centre.lng,
    from: days[0]?.date ?? '',
    // The app's date range is check-in to check-out; the last planned day
    // is the day you leave.
    to: days.at(-1)?.date ?? '',
    hotel: hotel ? { name: hotel.name.split(',')[0].trim(), label: hotel.name, lat: hotel.lat, lng: hotel.lng } : null,
    days,
  }
}

/* ---------- turning places into stops ---------- */

const plainName = (name) => name.split(',')[0].trim()

/** How many days the imported plan covers, gaps included. */
export function importSpan(imported) {
  const first = imported.days[0]?.date
  const last = imported.days.at(-1)?.date
  return first && last ? Math.round((new Date(last) - new Date(first)) / 86400000) + 1 : imported.days.length
}

/**
 * The imported days -> { [dayNumber]: stops }, in the app's stop shape.
 *
 * Google gives names and positions but no times, no Hebrew and no category,
 * so one AI call fills those in for every stop at once — keeping the user's
 * own order and places exactly, adding nothing. Without AI (or if it
 * fails), stops still arrive: 90 minutes apart from 09:00, named as Google
 * named them.
 */
export async function importedStops(imported) {
  // Day numbers come from each layer's distance to the map's OWN first date,
  // never from the trip's start date. Measured against the trip's start,
  // picking different dates in onboarding (the map's were in the past, so
  // the calendar made that the only option) turned every offset negative,
  // and the clamp below piled all four days onto day 1.
  const first = imported.days[0]?.date
  const days = imported.days.map((d, i) => {
    const n = d.date && first ? Math.round((new Date(d.date) - new Date(first)) / 86400000) + 1 : i + 1
    return { n: Math.max(1, n), places: d.places }
  })

  // Directions links without coordinates — rare, but look those up first.
  const missing = days.flatMap((d) => d.places).filter((p) => !hasPos(p))
  if (missing.length > 0) {
    const found = await geocodeAll(missing.map((p) => ({ ...p, query: p.name })), '')
    missing.forEach((p, i) => Object.assign(p, { lat: found[i]?.lat ?? null, lng: found[i]?.lng ?? null }))
  }

  const flat = days.flatMap((d) => d.places.filter(hasPos).map((p) => ({ day: d.n, p })))
  // One call per day, in parallel: a single call for the whole Lisbon map
  // (24 stops) ran out of output tokens after 13 rows and took 28 seconds.
  const perDay = await Promise.all(days.map((d) => enrich(flat.filter((f) => f.day === d.n))))
  const extra = perDay.flat()

  const out = {}
  flat.forEach(({ day, p }, i) => {
    const e = extra[i]
    const k = (out[day] ??= []).length
    const hour = 9 * 60 + k * 90
    out[day].push({
      id: `d${day}-imp${k + 1}`,
      name: plainName(p.name),
      he: e?.he || plainName(p.name),
      desc: e?.desc || p.desc || '',
      time: e?.time || `${String(Math.floor(hour / 60)).padStart(2, '0')}:${String(hour % 60).padStart(2, '0')}`,
      cat: normaliseCategory(e?.category || p.name),
      rating: null,
      lat: p.lat,
      lng: p.lng,
      imported: true,
    })
  })
  return out
}

/** Always returns one entry (or null) per input stop, so results line up. */
async function enrich(flat) {
  const none = flat.map(() => null)
  if (!hasAI || flat.length === 0) return none
  try {
    const text = await complete({
      system:
        'אתה עוזר לסדר מסלול טיול שהמשתמש כבר תכנן. אל תוסיף, תמחק או תשנה סדר של מקומות. ' + // i18n-ignore — AI prompt; see gemini.js language override
        'לכל שורה בקלט החזר בדיוק שורה אחת בפורמט:\n' + // i18n-ignore
        'מספר | שעה HH:MM | שם המקום בעברית | קטגוריה | משפט תיאור קצר\n' + // i18n-ignore
        'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר. ' + // i18n-ignore
        'השעות עולות לאורך כל יום, מתחילות בסביבות 09:00, עם זמן סביר לכל מקום ולמעבר ביניהם. ' + // i18n-ignore
        'בלי כותרות ובלי טקסט נוסף.', // i18n-ignore
      prompt: flat.map(({ p }, i) => `${i + 1} | ${p.name}`).join('\n'),
    })
    const rows = parseRows(text, ['n', 'time', 'he', 'category', 'desc'])
    const byN = new Map(rows.map((r) => [Number(r.n), r]))
    return flat.map((_, i) => {
      const r = byN.get(i + 1)
      return r && /^\d{1,2}:\d{2}$/.test(r.time) ? r : null
    })
  } catch (err) {
    record({ kind: 'ai', level: 'warn', message: `map import enrich failed: ${err?.message}` })
    return none
  }
}
