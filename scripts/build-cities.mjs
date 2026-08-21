/**
 * Generates src/cities.js — a curated destination list with verified
 * coordinates, resolved once here rather than looked up at runtime.
 *
 *   npm run cities:build
 *
 * Why a local list at all: Nominatim does full-text matching, not prefix
 * matching, so "Barce" never surfaces Barcelona and Hebrew fragments match
 * Israeli places instead of the intended city. A curated list gives instant,
 * correct autocomplete in Hebrew with no network call; Nominatim stays as the
 * fallback for destinations not on it.
 */
import { writeFileSync } from 'node:fs'

const WORKER = 'https://tripai-ai.tripai-app.workers.dev'
const ORIGIN = 'https://travel-ai-6de47.web.app'

// he | en (for geocoding) | country in Hebrew | emoji
const CITIES = `
פריז|Paris, France|צרפת|🗼
רומא|Rome, Italy|איטליה|🏛️
פראג|Prague, Czechia|צ׳כיה|🏰
ברצלונה|Barcelona, Spain|ספרד|🎨
מדריד|Madrid, Spain|ספרד|🇪🇸
לונדון|London, United Kingdom|אנגליה|☂️
אמסטרדם|Amsterdam, Netherlands|הולנד|🚲
ברלין|Berlin, Germany|גרמניה|🐻
מינכן|Munich, Germany|גרמניה|🍺
וינה|Vienna, Austria|אוסטריה|🎻
בודפשט|Budapest, Hungary|הונגריה|♨️
אתונה|Athens, Greece|יוון|🏺
סלוניקי|Thessaloniki, Greece|יוון|🌊
רודוס|Rhodes, Greece|יוון|🏖️
כרתים|Heraklion, Greece|יוון|🏝️
לרנקה|Larnaca, Cyprus|קפריסין|🌅
מילאנו|Milan, Italy|איטליה|👗
ונציה|Venice, Italy|איטליה|🚤
פירנצה|Florence, Italy|איטליה|🖼️
נאפולי|Naples, Italy|איטליה|🍕
ליסבון|Lisbon, Portugal|פורטוגל|🚋
פורטו|Porto, Portugal|פורטוגל|🍷
דבלין|Dublin, Ireland|אירלנד|☘️
קופנהגן|Copenhagen, Denmark|דנמרק|🧜
שטוקהולם|Stockholm, Sweden|שוודיה|🛥️
אוסלו|Oslo, Norway|נורווגיה|🏔️
הלסינקי|Helsinki, Finland|פינלנד|❄️
רייקיאוויק|Reykjavik, Iceland|איסלנד|🌋
ציריך|Zurich, Switzerland|שווייץ|🏔️
ז׳נבה|Geneva, Switzerland|שווייץ|⛲
בריסל|Brussels, Belgium|בלגיה|🧇
ורשה|Warsaw, Poland|פולין|🏛️
קרקוב|Krakow, Poland|פולין|🐉
בוקרשט|Bucharest, Romania|רומניה|🏰
סופיה|Sofia, Bulgaria|בולגריה|⛪
בלגרד|Belgrade, Serbia|סרביה|🌉
זאגרב|Zagreb, Croatia|קרואטיה|🇭🇷
דוברובניק|Dubrovnik, Croatia|קרואטיה|🏰
ספליט|Split, Croatia|קרואטיה|⛵
לובליאנה|Ljubljana, Slovenia|סלובניה|🐉
טביליסי|Tbilisi, Georgia|גאורגיה|🍇
באטומי|Batumi, Georgia|גאורגיה|🌊
ירוואן|Yerevan, Armenia|ארמניה|⛰️
באקו|Baku, Azerbaijan|אזרבייג׳ן|🔥
איסטנבול|Istanbul, Turkey|טורקיה|🕌
דובאי|Dubai, United Arab Emirates|איחוד האמירויות|🌇
אבו דאבי|Abu Dhabi, United Arab Emirates|איחוד האמירויות|🕌
דוחא|Doha, Qatar|קטאר|🏙️
עמאן|Amman, Jordan|ירדן|🏜️
קהיר|Cairo, Egypt|מצרים|🐫
מרקש|Marrakesh, Morocco|מרוקו|🕌
קזבלנקה|Casablanca, Morocco|מרוקו|🌊
בנגקוק|Bangkok, Thailand|תאילנד|🛕
פוקט|Phuket, Thailand|תאילנד|🏝️
צ׳יאנג מאי|Chiang Mai, Thailand|תאילנד|🐘
טוקיו|Tokyo, Japan|יפן|🗾
קיוטו|Kyoto, Japan|יפן|⛩️
אוסקה|Osaka, Japan|יפן|🍜
סיאול|Seoul, South Korea|קוריאה|🏯
בייג׳ינג|Beijing, China|סין|🏯
שנגחאי|Shanghai, China|סין|🌆
הונג קונג|Hong Kong|הונג קונג|🏙️
סינגפור|Singapore|סינגפור|🦁
קואלה לומפור|Kuala Lumpur, Malaysia|מלזיה|🏙️
באלי|Denpasar, Indonesia|אינדונזיה|🌺
הו צ׳י מין|Ho Chi Minh City, Vietnam|וייטנאם|🛵
האנוי|Hanoi, Vietnam|וייטנאם|🍲
דלהי|New Delhi, India|הודו|🕌
מומבאי|Mumbai, India|הודו|🎬
גואה|Panaji, India|הודו|🏖️
קטמנדו|Kathmandu, Nepal|נפאל|🏔️
קולומבו|Colombo, Sri Lanka|סרי לנקה|🌴
מלדיביים|Male, Maldives|מלדיביים|🏝️
ניו יורק|New York, United States|ארצות הברית|🗽
לוס אנג׳לס|Los Angeles, United States|ארצות הברית|🌴
סן פרנסיסקו|San Francisco, United States|ארצות הברית|🌉
לאס וגאס|Las Vegas, United States|ארצות הברית|🎰
מיאמי|Miami, United States|ארצות הברית|🏖️
שיקגו|Chicago, United States|ארצות הברית|🌃
בוסטון|Boston, United States|ארצות הברית|🎓
וושינגטון|Washington, United States|ארצות הברית|🏛️
אורלנדו|Orlando, United States|ארצות הברית|🎢
טורונטו|Toronto, Canada|קנדה|🍁
מונטריאול|Montreal, Canada|קנדה|🍁
ונקובר|Vancouver, Canada|קנדה|🏔️
מקסיקו סיטי|Mexico City, Mexico|מקסיקו|🌮
קנקון|Cancun, Mexico|מקסיקו|🏝️
הוואנה|Havana, Cuba|קובה|🚗
ריו דה ז׳ניירו|Rio de Janeiro, Brazil|ברזיל|🌴
סאו פאולו|Sao Paulo, Brazil|ברזיל|🏙️
בואנוס איירס|Buenos Aires, Argentina|ארגנטינה|💃
סנטיאגו|Santiago, Chile|צ׳ילה|🏔️
לימה|Lima, Peru|פרו|🦙
קוסקו|Cusco, Peru|פרו|🏔️
בוגוטה|Bogota, Colombia|קולומביה|☕
קייפטאון|Cape Town, South Africa|דרום אפריקה|🐧
ניירובי|Nairobi, Kenya|קניה|🦁
סידני|Sydney, Australia|אוסטרליה|🦘
מלבורן|Melbourne, Australia|אוסטרליה|☕
אוקלנד|Auckland, New Zealand|ניו זילנד|🥝
תל אביב|Tel Aviv, Israel|ישראל|🇮🇱
ירושלים|Jerusalem, Israel|ישראל|🕍
אילת|Eilat, Israel|ישראל|🐠
`.trim().split('\n').map((l) => {
  const [he, en, country, emoji] = l.split('|')
  return { he, en, country, emoji }
})

console.log(`resolving ${CITIES.length} destinations...\n`)

const out = []
let failed = 0

for (const c of CITIES) {
  // Nominatim allows one request per second; bursting past that gets you
  // empty results rather than an error, which looks like bad data.
  await new Promise((r) => setTimeout(r, 1200))

  const r = await fetch(
    `${WORKER}/geocode?limit=1&q=${encodeURIComponent(c.en)}`,
    { headers: { Origin: ORIGIN } }
  )
  const [hit] = r.ok ? await r.json() : []

  if (!hit) {
    console.log(`  ✖ ${c.he} (${c.en})`)
    failed++
    continue
  }

  out.push({
    he: c.he,
    en: c.en.split(',')[0].trim(),
    country: c.country,
    emoji: c.emoji,
    lat: +hit.lat.toFixed(4),
    lng: +hit.lng.toFixed(4),
  })
  process.stdout.write('.')
}

console.log(`\n\n${out.length} resolved, ${failed} failed`)

const file = `/**
 * Curated destinations with verified coordinates.
 *
 * GENERATED by scripts/build-cities.mjs — do not edit by hand.
 *
 * This exists because Nominatim matches full text rather than prefixes: typing
 * "Barce" never surfaces Barcelona, and Hebrew fragments match Israeli places
 * instead of the intended city. Searching this list locally is instant, correct
 * in Hebrew, and costs no request; Nominatim remains the fallback for anywhere
 * not listed here.
 */

export const CITIES = ${JSON.stringify(out, null, 2)}

/** Prefix-first, then substring, over both Hebrew and English names. */
export function searchCities(query, limit = 6) {
  const q = query.trim().toLowerCase()
  if (q.length < 1) return []

  const starts = []
  const contains = []

  for (const c of CITIES) {
    const he = c.he.toLowerCase()
    const en = c.en.toLowerCase()
    if (he.startsWith(q) || en.startsWith(q)) starts.push(c)
    else if (he.includes(q) || en.includes(q) || c.country.toLowerCase().includes(q)) contains.push(c)
    if (starts.length >= limit) break
  }

  return [...starts, ...contains].slice(0, limit)
}
`

writeFileSync('src/cities.js', file)
console.log('wrote src/cities.js')
