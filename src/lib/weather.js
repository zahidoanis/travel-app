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
 * @returns {Promise<{tempC:number, period:'morning'|'noon'|'evening'|'night', isDay:boolean, icon:string}|null>}
 * null on missing coordinates or a failed fetch — the caller shows nothing
 * rather than a wrong temperature or the wrong time of day.
 */
export async function fetchWeather(lat, lng) {
  if (lat == null || lng == null) return null

  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lng,
      current: 'temperature_2m,is_day,weather_code',
      timezone: 'auto',
    })
    const res = await fetch(`${API}?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    const c = data.current
    if (!c || typeof c.temperature_2m !== 'number') return null

    // "2026-08-22T23:45" in the destination's own zone, courtesy of
    // timezone=auto — the hour comes straight out of the string.
    const hour = Number(String(c.time).slice(11, 13))

    return {
      tempC: Math.round(c.temperature_2m),
      isDay: c.is_day === 1,
      period: periodFor(hour),
      icon: ICON[c.weather_code] ?? (c.is_day ? '🌤️' : '🌙'),
    }
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
