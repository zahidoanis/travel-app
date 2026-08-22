/**
 * Local currency for the destination, and live exchange rates.
 *
 * Rates come from Frankfurter (European Central Bank data) — free, no key,
 * CORS open, updated每 working day. The hardcoded table that used to live in
 * data.js had drifted 15% on EUR, which is the kind of error that looks
 * plausible right up until someone budgets with it.
 */

import { record } from './telemetry'

// frankfurter.app moved to frankfurter.dev (and /latest -> /v1/latest). The
// old domain still resolves, but as a 301 with no CORS header on the
// redirect itself — a browser refuses to follow a cross-origin redirect
// that isn't explicitly allowed, so fetch() failed outright with an opaque
// "Failed to fetch" no matter how the request was built.
const API = 'https://api.frankfurter.dev/v1/latest'

/** Currencies the ECB feed covers. Anything outside falls back to EUR/USD. */
export const SUPPORTED = [
  'ILS', 'EUR', 'USD', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'NZD', 'SGD',
  'HKD', 'CNY', 'KRW', 'INR', 'IDR', 'MYR', 'PHP', 'THB', 'TRY', 'ZAR',
  'BRL', 'MXN', 'CZK', 'PLN', 'HUF', 'RON', 'DKK', 'SEK', 'NOK', 'ISK',
]

export const SYMBOL = {
  ILS: '₪', EUR: '€', USD: '$', GBP: '£', CHF: 'Fr', JPY: '¥', AUD: 'A$',
  CAD: 'C$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$', CNY: '¥', KRW: '₩',
  INR: '₹', IDR: 'Rp', MYR: 'RM', PHP: '₱', THB: '฿', TRY: '₺', ZAR: 'R',
  BRL: 'R$', MXN: 'MX$', CZK: 'Kč', PLN: 'zł', HUF: 'Ft', RON: 'lei',
  DKK: 'kr', SEK: 'kr', NOK: 'kr', ISK: 'kr',
  // Real currencies with no live rate available — see isConvertible(). Their
  // symbol still matters for the "this is what you'll actually spend" note.
  AED: 'د.إ', EGP: 'ج.م', MAD: 'DH', JOD: 'JD', QAR: 'ر.ق',
  BGN: 'лв', RSD: 'дин.', GEL: '₾', AMD: '֏', AZN: '₼',
  VND: '₫', NPR: 'रू', LKR: 'Rs', MVR: 'Rf',
  ARS: '$', CLP: '$', PEN: 'S/', COP: '$', CUP: '$', KES: 'KSh',
}

/**
 * Country -> currency, keyed by the Hebrew names the app already uses plus
 * the English ones the geocoder returns, so a free-text destination resolves
 * as well as a curated one.
 */
const BY_COUNTRY = {
  // Eurozone
  'צרפת': 'EUR', 'France': 'EUR',
  'איטליה': 'EUR', 'Italia': 'EUR', 'Italy': 'EUR',
  'ספרד': 'EUR', 'España': 'EUR', 'Spain': 'EUR',
  'גרמניה': 'EUR', 'Deutschland': 'EUR', 'Germany': 'EUR',
  'הולנד': 'EUR', 'Nederland': 'EUR', 'Netherlands': 'EUR',
  'אוסטריה': 'EUR', 'Österreich': 'EUR', 'Austria': 'EUR',
  'יוון': 'EUR', 'Ελλάς': 'EUR', 'Greece': 'EUR',
  'פורטוגל': 'EUR', 'Portugal': 'EUR',
  'אירלנד': 'EUR', 'Ireland': 'EUR',
  'בלגיה': 'EUR', 'België': 'EUR', 'Belgium': 'EUR',
  'קפריסין': 'EUR', 'Cyprus': 'EUR',
  'סלובניה': 'EUR', 'Slovenija': 'EUR', 'Slovenia': 'EUR',
  'קרואטיה': 'EUR', 'Hrvatska': 'EUR', 'Croatia': 'EUR',
  'פינלנד': 'EUR', 'Suomi': 'EUR', 'Finland': 'EUR',

  // Europe, own currency
  'אנגליה': 'GBP', 'בריטניה': 'GBP', 'United Kingdom': 'GBP',
  'צ׳כיה': 'CZK', "צ'כיה": 'CZK', 'Česko': 'CZK', 'Czechia': 'CZK',
  'הונגריה': 'HUF', 'Magyarország': 'HUF', 'Hungary': 'HUF',
  'פולין': 'PLN', 'Polska': 'PLN', 'Poland': 'PLN',
  'רומניה': 'RON', 'România': 'RON', 'Romania': 'RON',
  'שווייץ': 'CHF', 'Schweiz': 'CHF', 'Switzerland': 'CHF',
  'דנמרק': 'DKK', 'Danmark': 'DKK', 'Denmark': 'DKK',
  'שוודיה': 'SEK', 'Sverige': 'SEK', 'Sweden': 'SEK',
  'נורווגיה': 'NOK', 'Norge': 'NOK', 'Norway': 'NOK',
  'איסלנד': 'ISK', 'Ísland': 'ISK', 'Iceland': 'ISK',
  'טורקיה': 'TRY', 'Türkiye': 'TRY', 'Turkey': 'TRY',
  'בולגריה': 'BGN', 'България': 'BGN', 'Bulgaria': 'BGN',
  'סרביה': 'RSD', 'Srbija': 'RSD', 'Serbia': 'RSD',
  'ארמניה': 'AMD', 'Հայաստան': 'AMD', 'Armenia': 'AMD',
  'אזרבייג׳ן': 'AZN', "אזרבייג'ן": 'AZN', 'Azərbaycan': 'AZN', 'Azerbaijan': 'AZN',
  'גאורגיה': 'GEL', 'საქართველო': 'GEL', 'Georgia': 'GEL',

  // Asia
  'יפן': 'JPY', '日本': 'JPY', 'Japan': 'JPY',
  'קוריאה': 'KRW', 'South Korea': 'KRW',
  'סין': 'CNY', '中国': 'CNY', 'China': 'CNY',
  'הונג קונג': 'HKD', 'Hong Kong': 'HKD',
  'סינגפור': 'SGD', 'Singapore': 'SGD',
  'תאילנד': 'THB', 'ประเทศไทย': 'THB', 'Thailand': 'THB',
  'מלזיה': 'MYR', 'Malaysia': 'MYR',
  'אינדונזיה': 'IDR', 'Indonesia': 'IDR',
  'הודו': 'INR', 'India': 'INR',
  'ישראל': 'ILS', 'Israel': 'ILS',

  // Americas, Africa, Oceania
  'ארצות הברית': 'USD', 'United States': 'USD',
  'קנדה': 'CAD', 'Canada': 'CAD',
  'מקסיקו': 'MXN', 'México': 'MXN', 'Mexico': 'MXN',
  'ברזיל': 'BRL', 'Brasil': 'BRL', 'Brazil': 'BRL',
  'דרום אפריקה': 'ZAR', 'South Africa': 'ZAR',
  'אוסטרליה': 'AUD', 'Australia': 'AUD',
  'ניו זילנד': 'NZD', 'New Zealand': 'NZD',
  'ארגנטינה': 'ARS', 'Argentina': 'ARS',
  'צ׳ילה': 'CLP', "צ'ילה": 'CLP', 'Chile': 'CLP',
  'פרו': 'PEN', 'Perú': 'PEN', 'Peru': 'PEN',
  'קולומביה': 'COP', 'Colombia': 'COP',
  'קובה': 'CUP', 'Cuba': 'CUP',
  'קניה': 'KES', 'Kenya': 'KES',

  // South & Southeast Asia beyond the ECB set
  'וייטנאם': 'VND', 'Việt Nam': 'VND', 'Vietnam': 'VND',
  'נפאל': 'NPR', 'नेपाल': 'NPR', 'Nepal': 'NPR',
  'סרי לנקה': 'LKR', 'ශ්‍රී ලංකාව': 'LKR', 'Sri Lanka': 'LKR',
  'מלדיביים': 'MVR', 'Maldives': 'MVR',

  // Middle East — real local currency. USD is what tourist prices are often
  // quoted in across this group, which is handled as a display fallback in
  // Finance.jsx (isConvertible) rather than baked in here as a wrong answer
  // to "what currency is this".
  'איחוד האמירויות': 'AED', 'الإمارات العربية المتحدة': 'AED', 'United Arab Emirates': 'AED',
  'קטאר': 'QAR', 'قطر': 'QAR', 'Qatar': 'QAR',
  'מצרים': 'EGP', 'مصر': 'EGP', 'Egypt': 'EGP',
  'מרוקו': 'MAD', 'المغرب': 'MAD', 'Morocco': 'MAD',
  'ירדן': 'JOD', 'الأردن': 'JOD', 'Jordan': 'JOD',
}

/**
 * The currency actually spent at the destination — identification, not a
 * promise that the calculator below can convert it. Every country in the
 * curated destination list resolves to its real ISO code now; before, a
 * country not in this table fell through to a bare "return EUR", which is
 * simply wrong for, say, Kenya or Peru — not an approximation, just false.
 * Whether a live rate exists for the result is a separate question — see
 * isConvertible().
 */
export function localCurrency(country = '', city = '') {
  const hit = BY_COUNTRY[country.trim()]
  if (hit) return hit

  // Local-script country names the geocoder can return for a free-text
  // search that never went through the curated list above (which already
  // carries the Hebrew and English forms). Kept narrow and last, behind the
  // exact-match table.
  if (/דובאי|אמירויות|Emirates/i.test(`${country} ${city}`)) return 'AED'
  if (/קטאר|قطر|Qatar/i.test(`${country} ${city}`)) return 'QAR'
  if (/מצרים|مصر|Egypt/i.test(`${country} ${city}`)) return 'EGP'
  if (/מרוקו|المغرب|Morocco/i.test(`${country} ${city}`)) return 'MAD'
  if (/ירדן|الأردن|Jordan/i.test(`${country} ${city}`)) return 'JOD'

  // Genuinely unknown: USD is the closer default than EUR for most of the
  // world outside Europe, and is at least usable as a reference point.
  return 'USD'
}

/** Whether the free rate feed actually covers this currency. */
export const isConvertible = (code) => SUPPORTED.includes(code)

/**
 * Rates against one base. Returns null on failure so the caller can say the
 * rate is unavailable rather than show a wrong number.
 */
export async function fetchRates(base = 'ILS') {
  try {
    const res = await fetch(`${API}?base=${encodeURIComponent(base)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    return { base: data.base, date: data.date, rates: { ...data.rates, [base]: 1 } }
  } catch (err) {
    record({
      kind: 'network',
      level: 'warn',
      message: `שערי המרה לא נטענו: ${err?.message ?? err}`,
      context: { base },
    })
    return null
  }
}
