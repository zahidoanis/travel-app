/**
 * Google Static Maps URL builder — the ONLY place a map URL is constructed.
 *
 * The prototype renders a hand-drawn SVG map by default so it looks right with
 * zero configuration. Drop a key into `.env.local` as:
 *
 *     VITE_GOOGLE_MAPS_KEY=AIza...
 *
 * ...and <MapCanvas> switches to real Google Static Maps imagery automatically.
 */

const KEY = import.meta.env?.VITE_GOOGLE_MAPS_KEY ?? ''

export const hasMapsKey = Boolean(KEY)

/** Dark map styling that matches the app palette. Kept as one shared constant
 *  so every map in the app is visually identical. */
const DARK_STYLE = [
  'feature:all|element:geometry|color:0x0f1018',
  'feature:all|element:labels.text.fill|color:0x8e8ab4',
  'feature:all|element:labels.text.stroke|color:0x0d0e15',
  'feature:poi|element:labels|visibility:off',
  'feature:road|element:geometry|color:0x1c1d2e',
  'feature:road.highway|element:geometry|color:0x272845',
  'feature:transit|visibility:off',
  'feature:water|element:geometry|color:0x0a1b26',
  'feature:landscape|element:geometry|color:0x121320',
]

/** Round to 5 decimals (~1.1 m) so identical views produce identical URLs and
 *  hit the browser/CDN cache instead of being re-billed. */
const coord = (lat, lng) => `${lat.toFixed(5)},${lng.toFixed(5)}`

/**
 * @param {object}   o
 * @param {[number,number]} [o.center]      - [lat, lng]
 * @param {number}   [o.zoom]
 * @param {string}   [o.size]               - "WxH", max 640x640
 * @param {number}   [o.scale]              - 1 or 2 (2 = retina, same billing)
 * @param {Array}    [o.markers]            - [{ lat, lng, color, label }]
 * @param {string}   [o.path]               - encoded polyline (no "enc:" prefix)
 * @param {Array}    [o.visible]            - [[lat, lng], ...] to auto-fit bounds
 * @param {string}   [o.mapType]
 */
export function buildStaticMapUrl({
  center,
  zoom,
  size = '640x640',
  scale = 2,
  markers = [],
  path,
  visible = [],
  mapType = 'roadmap',
} = {}) {
  const p = new URLSearchParams()

  // `visible` auto-fits the bounds — preferred for multi-stop itineraries.
  if (center) p.set('center', coord(center[0], center[1]))
  if (zoom != null) p.set('zoom', String(zoom))
  p.set('size', size)
  p.set('scale', String(scale))
  p.set('maptype', mapType)

  const qs = []
  for (const [k, v] of p) qs.push(`${k}=${encodeURIComponent(v)}`)

  for (const s of DARK_STYLE) qs.push(`style=${encodeURIComponent(s)}`)

  for (const m of markers) {
    const parts = [`color:${m.color ?? '0x6366F1'}`]
    if (m.label) parts.push(`label:${m.label}`)
    parts.push(coord(m.lat, m.lng))
    qs.push(`markers=${encodeURIComponent(parts.join('|'))}`)
  }

  if (path) {
    qs.push(`path=${encodeURIComponent(`weight:4|color:0x22D3EECC|enc:${path}`)}`)
  }

  for (const v of visible) qs.push(`visible=${encodeURIComponent(coord(v[0], v[1]))}`)

  qs.push(`key=${KEY}`)

  const url = `https://maps.googleapis.com/maps/api/staticmap?${qs.join('&')}`

  // Static Maps rejects anything past 16,384 chars.
  if (url.length > 16384) {
    console.warn('[staticMap] URL exceeds 16,384 chars — simplify the polyline.')
  }
  return url
}

/** Deep-link out to the real Google Maps app for turn-by-turn navigation. */
export const navigateUrl = (lat, lng, label) =>
  `https://www.google.com/maps/dir/?api=1&destination=${coord(lat, lng)}` +
  (label ? `&destination_place_id=&travelmode=walking` : '')
