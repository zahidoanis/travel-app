/**
 * Live temperature and local time-of-day at the destination.
 *
 * Open-Meteo — free, keyless, CORS-open, the same "free forever" bar every
 * other integration in this app holds to. `timezone=auto` is what makes this
 * honest rather than a guess: it resolves the destination's own IANA zone
 * from the coordinates and returns `current.time` already in that local
 * time, so "is it morning there" never depends on the visitor's own clock.
 *
 * A weather readout used to live on TopBar and was removed because nothing
 * backed it — an invented number is worse than none. This is the real one.
 */

import { record } from './telemetry'

const API = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive'

// Rain-shaped WMO codes — everything from drizzle through thunderstorms —
// used to turn a pile of past daily codes into one "chance of rain" figure.
const RAINY_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])

/** WMO weather codes, condensed to one glyph each. */
const ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️', 56: '🌦️', 57: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️',
  80: '🌧️', 81: '🌧️', 82: '⛈️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
}

export const GREETING = {
  morning: 'בוקר טוב',
  noon: 'צהריים טובים',
  evening: 'ערב טוב',
  night: 'לילה טוב',
}

function periodFor(hour) {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'noon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

/**
 * Now, the rest of today by the hour, and the coming week — one request.
 * Requesting all three together costs nothing extra (Open-Meteo answers with
 * the full payload regardless), and means opening the forecast sheet never
 * waits on a second round-trip for data Home already had.
 *
 * @returns {Promise<{
 *   now: {tempC:number, period:'morning'|'noon'|'evening'|'night', isDay:boolean, icon:string},
 *   hours: {time:string, tempC:number, icon:string}[],
 *   days: {date:string, tempMax:number, tempMin:number, icon:string}[],
 * }|null>} null on missing coordinates or a failed fetch — the caller shows
 * nothing rather than a wrong temperature or the wrong time of day.
 */
export async function fetchForecast(lat, lng) {
  if (lat == null || lng == null) return null

  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lng,
      current: 'temperature_2m,is_day,weather_code',
      hourly: 'temperature_2m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,weather_code',
      timezone: 'auto',
      forecast_days: '7',
    })
    const res = await fetch(`${API}?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const c = data.current
    if (!c || typeof c.temperature_2m !== 'number') return null

    // "2026-08-22T23:45" in the destination's own zone, courtesy of
    // timezone=auto — date and hour come straight out of the string, no
    // timezone math of our own to get wrong.
    const today = String(c.time).slice(0, 10)
    const hour = Number(String(c.time).slice(11, 13))

    const now = {
      tempC: Math.round(c.temperature_2m),
      isDay: c.is_day === 1,
      period: periodFor(hour),
      icon: ICON[c.weather_code] ?? (c.is_day ? '🌤️' : '🌙'),
    }

    // The rest of today — from the current hour onward, not the whole day
    // including hours already past.
    const h = data.hourly ?? {}
    const hours = (h.time ?? [])
      .map((t, i) => ({ time: t, tempC: h.temperature_2m?.[i], code: h.weather_code?.[i] }))
      .filter((x) => x.time.startsWith(today) && Number(x.time.slice(11, 13)) >= hour)
      .map((x) => ({
        time: x.time,
        tempC: Math.round(x.tempC),
        icon: ICON[x.code] ?? '🌤️',
      }))

    const d = data.daily ?? {}
    const days = (d.time ?? []).map((date, i) => ({
      date,
      tempMax: Math.round(d.temperature_2m_max?.[i]),
      tempMin: Math.round(d.temperature_2m_min?.[i]),
      icon: ICON[d.weather_code?.[i]] ?? '🌤️',
    }))

    return { now, hours, days }
  } catch (err) {
    record({
      kind: 'network',
      level: 'warn',
      message: `מזג אוויר לא נטען: ${err?.message ?? err}`,
      context: { lat, lng },
    })
    return null
  }
}

/**
 * "Typically, around these dates" — not a forecast. Open-Meteo's forecast
 * only reaches a week or two out; a trip planned months ahead has nothing
 * real to show yet, and showing today's actual weather at the destination
 * in its place used to just be quietly wrong (a sunny reading for a trip
 * that's actually in the rainy season). Instead this averages the same
 * ±3-day window around the target date across each of the last 3 complete
 * years — three small requests to Open-Meteo's free historical archive,
 * run in parallel — and returns a range plus a rough rain likelihood.
 * Callers must label this as an estimate, never as today's weather.
 *
 * @returns {Promise<{tempMax:number, tempMin:number, icon:string, rainChance:number, years:number}|null>}
 */
export async function fetchClimateAverage(lat, lng, month, day) {
  if (lat == null || lng == null) return null

  const pad = (n) => String(n).padStart(2, '0')
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const thisYear = new Date().getFullYear()
  // The three most recently *complete* years — this year's own date for the
  // target month/day may not have happened yet, which would ask the archive
  // for a window partly in the future.
  const years = [1, 2, 3].map((back) => thisYear - back)

  try {
    const windows = years.map((year) => {
      const center = new Date(year, month - 1, day)
      const start = new Date(center)
      start.setDate(start.getDate() - 3)
      const end = new Date(center)
      end.setDate(end.getDate() + 3)
      return { start: isoLocal(start), end: isoLocal(end) }
    })

    const results = await Promise.all(
      windows.map(({ start, end }) => {
        const params = new URLSearchParams({
          latitude: lat,
          longitude: lng,
          start_date: start,
          end_date: end,
          daily: 'temperature_2m_max,temperature_2m_min,weather_code',
          timezone: 'auto',
        })
        return fetch(`${ARCHIVE_API}?${params}`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      })
    )

    const maxes = []
    const mins = []
    const codes = []
    for (const data of results) {
      const d = data?.daily
      if (!d?.time) continue
      for (let i = 0; i < d.time.length; i++) {
        if (typeof d.temperature_2m_max?.[i] === 'number') maxes.push(d.temperature_2m_max[i])
        if (typeof d.temperature_2m_min?.[i] === 'number') mins.push(d.temperature_2m_min[i])
        if (d.weather_code?.[i] != null) codes.push(d.weather_code[i])
      }
    }
    if (maxes.length === 0) return null

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length

    // The most frequent icon, not a literal average of the codes — averaging
    // "clear" (0) with "thunderstorm" (95) lands on a meaningless code in
    // between that maps to neither.
    const counts = new Map()
    for (const c of codes) {
      const icon = ICON[c] ?? '🌤️'
      counts.set(icon, (counts.get(icon) ?? 0) + 1)
    }
    const icon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '🌤️'
    const rainChance = codes.length
      ? Math.round((codes.filter((c) => RAINY_CODES.has(c)).length / codes.length) * 100)
      : 0

    return {
      tempMax: Math.round(avg(maxes)),
      tempMin: Math.round(avg(mins)),
      icon,
      rainChance,
      years: years.length,
    }
  } catch (err) {
    record({
      kind: 'network',
      level: 'warn',
      message: `ממוצע אקלים לא נטען: ${err?.message ?? err}`,
      context: { lat, lng },
    })
    return null
  }
}
