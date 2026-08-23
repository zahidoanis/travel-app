/**
 * Place photography from Wikipedia — free, no API key, CORS open.
 *
 * Landmarks, museums and parks nearly always have an article with a lead
 * image. Restaurants nearly never do, so callers must handle a null and fall
 * back to something. Missing photo is the common case, not the error case.
 */

import { record } from './telemetry'

const API = 'https://en.wikipedia.org/api/rest_v1/page/summary'
const ACTION_API = 'https://en.wikipedia.org/w/api.php'
const cache = new Map()
const inflight = new Map()
const heroCache = new Map()
const heroInflight = new Map()

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

/**
 * A full-bleed background needs more than the 330px thumbnail the summary
 * API hands out — stretched across a hero card that reads as blur, not a
 * photo. The REST thumbnail endpoint only serves a fixed set of pre-baked
 * widths and 400s on anything else; the older action API's `pithumbsize`
 * generates whatever width is asked for, so this is a second call rather
 * than a size tacked onto placePhoto's URL. `origin=*` is the documented
 * way to get CORS on api.php — without it the browser blocks the response
 * entirely despite the request succeeding server-side.
 *
 * @returns {Promise<{url: string, width: number, height: number} | null>}
 */
export function heroPhoto(name, width = 1200) {
  const title = titleOf(name ?? '')
  if (title.length < 2) return Promise.resolve(null)

  const key = `${title}@${width}`
  if (heroCache.has(key)) return Promise.resolve(heroCache.get(key))
  if (heroInflight.has(key)) return heroInflight.get(key)

  const request = (async () => {
    try {
      const params = new URLSearchParams({
        action: 'query', titles: title, prop: 'pageimages',
        pithumbsize: String(width), format: 'json', origin: '*',
      })
      const res = await fetch(`${ACTION_API}?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = await res.json()
      const page = Object.values(data?.query?.pages ?? {})[0]
      const thumb = page?.thumbnail

      const usable = thumb ? { url: thumb.source, width: thumb.width, height: thumb.height } : null
      heroCache.set(key, usable)
      return usable
    } catch (err) {
      record({
        kind: 'network',
        level: 'warn',
        message: `לא נטענה תמונת רקע עבור "${title}"`,
        context: { title, error: err?.message },
      })
      return null
    } finally {
      heroInflight.delete(key)
    }
  })()

  heroInflight.set(key, request)
  return request
}
