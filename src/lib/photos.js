/**
 * Place photography from Wikipedia — free, no API key, CORS open.
 *
 * Landmarks, museums and parks nearly always have an article with a lead
 * image. Restaurants nearly never do, so callers must handle a null and fall
 * back to something. Missing photo is the common case, not the error case.
 */

import { record } from './telemetry'

const API = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const cache = new Map()
const inflight = new Map()

/** Strips the ", City, Country" the itinerary carries for geocoding. */
const titleOf = (name) => name.split(',')[0].trim()

/**
 * @returns {Promise<{url: string, width: number, height: number} | null>}
 */
export function placePhoto(name) {
  const title = titleOf(name ?? '')
  if (title.length < 2) return Promise.resolve(null)

  if (cache.has(title)) return Promise.resolve(cache.get(title))
  // Several cards can ask for the same place at once; one request serves all.
  if (inflight.has(title)) return inflight.get(title)

  const request = (async () => {
    try {
      const res = await fetch(`${API}/${encodeURIComponent(title)}`, {
        headers: { Accept: 'application/json' },
      })

      // 404 means no article — expected for most restaurants, not a failure.
      if (!res.ok) {
        cache.set(title, null)
        return null
      }

      const data = await res.json()
      const thumb = data.thumbnail

      // Disambiguation pages carry a generic icon rather than the place.
      const usable =
        thumb && data.type !== 'disambiguation'
          ? { url: thumb.source, width: thumb.width, height: thumb.height }
          : null

      cache.set(title, usable)
      return usable
    } catch (err) {
      record({
        kind: 'network',
        level: 'warn',
        message: `לא נטענה תמונה עבור "${title}"`,
        context: { title, error: err?.message },
      })
      return null
    } finally {
      inflight.delete(title)
    }
  })()

  inflight.set(title, request)
  return request
}
