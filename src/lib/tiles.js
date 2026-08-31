/**
 * Slippy-map tile math + free, keyless tile providers.
 *
 * Instead of paying Google to composite a map image for us, we fetch the same
 * OpenStreetMap-derived raster tiles a normal map library would and lay them
 * out ourselves. No API key, no billing account, no SDK dependency.
 */

export const TILE_SIZE = 256

/**
 * All of these serve tiles without an API key.
 *
 * Attribution is a licence condition, not a courtesy — <MapCanvas> renders the
 * `attribution` string over the map, so don't remove it.
 *
 * Fair use: these are free public endpoints. Fine for a prototype or a modest
 * app; a high-traffic production deployment is expected to sign up with the
 * provider or self-host.
 *
 * CARTO's basemaps (light_all / dark_all / light_nolabels) used to be here
 * too, and were the default — CARTO has since locked anonymous access behind
 * an API key. The tile request still returns 200 with a real image, just
 * with "API KEY REQUIRED" baked into it, so this broke silently rather than
 * throwing anything catchable. OSM's own tile server is the one provider
 * left that is still genuinely keyless.
 */
export const PROVIDERS = {
  osm: {
    label: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    dark: false,
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  },
}

/** Web Mercator: lat/lng -> absolute pixel position at a given zoom. */
export function project(lat, lng, z) {
  const scale = 2 ** z * TILE_SIZE
  const latRad = (lat * Math.PI) / 180
  return {
    x: ((lng + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  }
}

/** Metres per pixel at a latitude — used to pick a zoom that fits the route. */
export function resolution(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z
}

/**
 * Largest zoom at which every point still fits inside `width` x `height`,
 * leaving `pad` pixels of breathing room on each side.
 */
export function fitZoom(points, width, height, pad = 60, min = 3, max = 17) {
  for (let z = max; z >= min; z--) {
    const xs = points.map((p) => project(p[0], p[1], z).x)
    const ys = points.map((p) => project(p[0], p[1], z).y)
    const w = Math.max(...xs) - Math.min(...xs)
    const h = Math.max(...ys) - Math.min(...ys)
    if (w <= width - pad * 2 && h <= height - pad * 2) return z
  }
  return min
}

/**
 * Which tiles are needed to keep the viewport covered for every pan position.
 *
 * `anchor` is the fixed layout origin; `spread` is how far the map can pan away
 * from it. Returning a single range for all pan positions means tile elements
 * are laid out once and only the container transform animates.
 */
export function tileRange(anchor, spread, viewport, z) {
  const n = 2 ** z
  const halfW = viewport.width / 2 + spread.x
  const halfH = viewport.height / 2 + spread.y

  const clamp = (v) => Math.max(0, Math.min(n - 1, v))

  return {
    x0: clamp(Math.floor((anchor.x - halfW) / TILE_SIZE)),
    x1: clamp(Math.floor((anchor.x + halfW) / TILE_SIZE)),
    y0: clamp(Math.floor((anchor.y - halfH) / TILE_SIZE)),
    y1: clamp(Math.floor((anchor.y + halfH) / TILE_SIZE)),
  }
}

/** Flatten a range into the list of tiles to render. */
export function tilesIn(range) {
  const out = []
  for (let x = range.x0; x <= range.x1; x++) {
    for (let y = range.y0; y <= range.y1; y++) out.push({ x, y })
  }
  return out
}
