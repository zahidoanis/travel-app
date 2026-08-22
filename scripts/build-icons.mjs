/**
 * Generates the app icons used when someone installs TripAI to a home
 * screen — Android's "Install app" and iOS's "Add to Home Screen" both read
 * these rather than taking a screenshot of the page.
 *
 * Written as a plain PNG encoder (zlib is the only dependency, and it ships
 * with Node) rather than pulling in a canvas library, since the whole output
 * is one gradient plus a single flat glyph — nothing an image library would
 * meaningfully simplify.
 *
 *   node scripts/build-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const GOLD = [232, 200, 138]   // #E8C88A — the wordmark's bronze
const PURPLE = [168, 85, 247]  // #A855F7 — the wordmark's purple
const SS = 4                   // supersample factor for antialiasing

/**
 * An airplane climbing on takeoff, built the same way the rest of this file
 * works: flat triangles, no curves. Drawn level first — fuselage, tail fin,
 * one swept wing, three motion streaks trailing behind — then rotated
 * nose-up around the fuselage's own centre so the streaks read as the ground
 * falling away rather than the whole composition just tilting in place.
 * Coordinates are y-down, matching SVG and this file's pixel space.
 */
const FUSELAGE = [
  [8, 50], [26, 42], [78, 44], [94, 50], [78, 56], [26, 58],
]
const TAIL_FIN = [[14, 44], [24, 44], [20, 18]]
const WING = [[46, 50], [62, 50], [50, 82]]
const STREAKS = [
  [[-16, 36], [-2, 36], [-2, 40], [-16, 40]],
  [[-22, 47], [-2, 47], [-2, 51], [-22, 51]],
  [[-16, 58], [-2, 58], [-2, 62], [-16, 62]],
]

// Fan-triangulate the fuselage hexagon and each streak rectangle; the fin
// and wing are already triangles.
const fan = (poly) => poly.slice(1, -1).map((_, i) => [poly[0], poly[i + 1], poly[i + 2]])
const LEVEL = [...fan(FUSELAGE), TAIL_FIN, WING, ...STREAKS.flatMap(fan)]

const CLIMB = (-25 * Math.PI) / 180
const [cx, cy] = FUSELAGE.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0])
  .map((s) => s / FUSELAGE.length)

function rotate([x, y]) {
  const dx = x - cx, dy = y - cy
  const s = Math.sin(CLIMB), c = Math.cos(CLIMB)
  return [cx + dx * c - dy * s, cy + dx * s + dy * c]
}

const TRIANGLES = LEVEL.map((tri) => tri.map(rotate))

// The plane's own bounding box, not a fixed 24x24 — the streaks make it
// wider than it is tall, and centring only makes sense against its own shape.
const xs = TRIANGLES.flat().map((p) => p[0])
const ys = TRIANGLES.flat().map((p) => p[1])
const BOX = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
const BOX_W = BOX.maxX - BOX.minX
const BOX_H = BOX.maxY - BOX.minY

function sign(p1, p2, p3) {
  return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
}

function inTriangle(pt, a, b, c) {
  const d1 = sign(pt, a, b)
  const d2 = sign(pt, b, c)
  const d3 = sign(pt, c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Renders one icon at `size`, with the glyph occupying `glyphFrac` of the
 * canvas. Maskable icons get a smaller fraction so nothing important sits
 * outside Android's adaptive-icon safe zone, which can clip up to 20% of
 * each edge depending on the launcher's mask shape.
 */
function render(size, glyphFrac) {
  const hi = size * SS
  const box = hi * glyphFrac
  // Fit the longer axis into the box and centre the shorter one, so the
  // wider-than-tall silhouette doesn't get stretched to fill a square.
  const scale = box / Math.max(BOX_W, BOX_H)
  const marginX = (hi - BOX_W * scale) / 2
  const marginY = (hi - BOX_H * scale) / 2

  const toPixel = ([x, y]) => [(x - BOX.minX) * scale + marginX, (y - BOX.minY) * scale + marginY]
  const tris = TRIANGLES.map((t) => t.map(toPixel))

  const px = new Uint8ClampedArray(hi * hi * 4)
  for (let y = 0; y < hi; y++) {
    for (let x = 0; x < hi; x++) {
      const t = (x + y) / (2 * hi)
      const [r, g, b] = lerp(GOLD, PURPLE, t)
      const inGlyph = tris.some(([a, b2, c]) => inTriangle([x, y], a, b2, c))
      const i = (y * hi + x) * 4
      if (inGlyph) {
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255
      } else {
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255
      }
    }
  }

  // Downsample hi -> size, averaging each SSxSS block for antialiased edges.
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const si = ((y * SS + sy) * hi + (x * SS + sx)) * 4
          r += px[si]; g += px[si + 1]; b += px[si + 2]; a += px[si + 3]
        }
      }
      const n = SS * SS
      const oi = (y * size + x) * 4
      out[oi] = r / n; out[oi + 1] = g / n; out[oi + 2] = b / n; out[oi + 3] = a / n
    }
  }
  return out
}

/* ---- minimal PNG encoder: signature + IHDR + IDAT + IEND ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(rgba, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }

  const idat = deflateSync(raw)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---- write every size the manifest and index.html reference ---- */

mkdirSync('public/icons', { recursive: true })

const targets = [
  ['public/icons/icon-512.png', 512, 0.58],
  ['public/icons/icon-512-maskable.png', 512, 0.42],
  ['public/icons/icon-192.png', 192, 0.58],
  ['public/icons/apple-touch-icon.png', 180, 0.58],
  ['public/favicon.png', 32, 0.6],
]

for (const [path, size, frac] of targets) {
  writeFileSync(path, encodePNG(render(size, frac), size))
  console.log(`  wrote ${path} (${size}x${size})`)
}

console.log('\n✔ icons generated\n')
