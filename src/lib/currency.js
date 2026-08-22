/**
 * Local currency for the destination, and live exchange rates.
 *
 * Rates come from Frankfurter (European Central Bank data) — free, no key,
 * CORS open, updated每 working day. The hardcoded table that used to live in
 * data.js had drifted 15% on EUR, which is the kind of error that looks
 * plausible right up until someone budgets with it.
 */

import { record } from './telemetry'

const API = 'https://api.frankfurter.app/latest'

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
}

/**
 * The currency to spend at the destination.
 *
 * Countries the ECB feed does not cover — Egypt, Morocco, the Gulf, Georgia,
 * Vietnam — return EUR or USD, which is what those places quote tourist
 * prices in anyway. Better a currency we can convert honestly than one we
 * would have to invent a rate for.
 */
export function localCurrency(country = '', city = '') {
  const hit = BY_COUNTRY[country.trim()]
  if (hit) return hit

  // A few destinations where the country name varies but the answer is clear.
  if (/דובאי|אמירויות|קטאר|Emirates|Qatar/i.test(`${country} ${city}`)) return 'USD'
  if (/מצרים|מרוקו|ירדן|Egypt|Morocco|Jordan/i.test(`${country} ${city}`)) return 'USD'

  return 'EUR'
}

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
