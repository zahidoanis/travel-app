/**
 * Calendar dates as 'YYYY-MM-DD' strings — the shape every trip date in the
 * app is stored in.
 *
 * The one rule: never go through `toISOString()` to get "today". That is the
 * date in Greenwich, and in Israel it is still yesterday until 2 or 3 in the
 * morning — which is how a trip stayed on day 1 for the first hours of day 2,
 * and how yesterday stayed selectable as a start date after midnight.
 * "Today" is always the device's own calendar date; arithmetic between two
 * dates is done in UTC, where there is no daylight-saving hour to trip over.
 *
 * No imports, so the tests can load it without a bundler.
 */

const pad = (n) => String(n).padStart(2, '0')

const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** The device's calendar date. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The device's clock as 'HH:MM' — comparable to a stop's time as a string. */
export function nowHHMM(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** Whole days from one date to another; negative when `to` is earlier. */
export function daysBetween(fromISO, toISO) {
  return Math.round((utc(toISO) - utc(fromISO)) / 86400000)
}

export function addDaysISO(iso, days) {
  return new Date(utc(iso) + days * 86400000).toISOString().slice(0, 10)
}
