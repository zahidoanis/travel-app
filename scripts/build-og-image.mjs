/**
 * Generates the social-share preview card (og:image / twitter:image) shown
 * when a TripAI link is pasted into WhatsApp, iMessage, etc. — the exact
 * moment the app's own "share the trip" feature depends on making a good
 * first impression, which an unstyled link card undermines.
 *
 * Recreated from Welcome.jsx's actual header rather than designed fresh: the
 * same wordmark treatment (Rubik 300 "Trip" + a gold→purple gradient "AI"
 * in Rubik 600), the same soft purple/cyan aura, the same tagline in Rubik
 * 500 — so the card matches what the link then opens into, not a different
 * "marketing version" of the brand.
 *
 * Uses @napi-rs/canvas (prebuilt binary, no system Cairo/Pango like
 * node-canvas needs) rather than a headless browser — a static card with a
 * few text runs and gradients doesn't need a full page renderer.
 *
 *   node scripts/build-og-image.mjs
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

const W = 1200
const H = 630

GlobalFonts.registerFromPath('scripts/assets/Rubik-Light.ttf', 'Rubik Light')
GlobalFonts.registerFromPath('scripts/assets/Rubik-Medium.ttf', 'Rubik Medium')
GlobalFonts.registerFromPath('scripts/assets/Rubik-SemiBold.ttf', 'Rubik SemiBold')

const canvas = createCanvas(W, H)
const ctx = canvas.getContext('2d')

// Base — var(--bg-2).
ctx.fillStyle = '#FAFAFB'
ctx.fillRect(0, 0, W, H)

/**
 * .welcome-aura, ported: two large blurred colour pools behind the wordmark.
 * ctx.filter blur works here (Skia backend), same as the CSS `filter: blur`
 * it's copied from — no manual gradient-ring approximation needed.
 */
function aura() {
  ctx.save()
  ctx.filter = 'blur(46px)'
  const cx = W / 2
  const cy = H * 0.5

  const g1 = ctx.createRadialGradient(cx - 60, cy - 40, 0, cx - 60, cy - 40, 340)
  g1.addColorStop(0, 'rgba(168, 85, 247, 0.30)')
  g1.addColorStop(1, 'rgba(168, 85, 247, 0)')
  ctx.fillStyle = g1
  ctx.fillRect(0, 0, W, H)

  const g2 = ctx.createRadialGradient(cx + 140, cy + 60, 0, cx + 140, cy + 60, 340)
  g2.addColorStop(0, 'rgba(53, 228, 224, 0.16)')
  g2.addColorStop(1, 'rgba(53, 228, 224, 0)')
  ctx.fillStyle = g2
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}

/** .welcome-mark — the small rounded badge, with a simplified 4-point
 *  sparkle glyph standing in for the Lucide <Sparkles> icon. */
function mark() {
  const size = 76
  const x = W / 2 - size / 2
  const y = 170
  const r = 22

  ctx.save()
  const bg = ctx.createLinearGradient(x, y, x + size, y + size)
  bg.addColorStop(0, 'rgba(232,200,138,0.22)')
  bg.addColorStop(1, 'rgba(124,92,255,0.18)')
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, r)
  ctx.fill()
  ctx.strokeStyle = 'rgba(232, 200, 138, 0.4)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // A four-point sparkle: two overlapping teardrop halves per axis, drawn as
  // a simple quad-curve star — reads as a sparkle at this size without
  // needing an icon font.
  const cx = x + size / 2
  const cy = y + size / 2
  const spike = 20
  const waist = 5
  ctx.fillStyle = '#A0783F'
  ctx.beginPath()
  ctx.moveTo(cx, cy - spike)
  ctx.quadraticCurveTo(cx + waist, cy - waist, cx + spike, cy)
  ctx.quadraticCurveTo(cx + waist, cy + waist, cx, cy + spike)
  ctx.quadraticCurveTo(cx - waist, cy + waist, cx - spike, cy)
  ctx.quadraticCurveTo(cx - waist, cy - waist, cx, cy - spike)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** .wordmark + .wordmark-ai — "Trip" in light weight, "AI" gradient-filled,
 *  measured and placed side by side the same way CSS text flow would. */
function wordmark() {
  const y = 348
  ctx.textBaseline = 'alphabetic'

  ctx.font = '300 84px "Rubik Light"'
  const tripWidth = ctx.measureText('Trip').width
  ctx.font = '600 84px "Rubik SemiBold"'
  const aiWidth = ctx.measureText('AI').width

  const totalWidth = tripWidth + aiWidth
  const startX = W / 2 - totalWidth / 2

  ctx.font = '300 84px "Rubik Light"'
  ctx.fillStyle = '#0B0B12'
  ctx.textAlign = 'left'
  ctx.fillText('Trip', startX, y)

  ctx.font = '600 84px "Rubik SemiBold"'
  // Full edge-to-edge sweep across just the two "AI" glyphs — a diagonal
  // over that little horizontal room read as flat, muddy purple-brown
  // rather than a visible gold->purple transition.
  const grad = ctx.createLinearGradient(startX + tripWidth, 0, startX + totalWidth, 0)
  grad.addColorStop(0, '#A0783F')
  grad.addColorStop(1, '#A855F7')
  ctx.fillStyle = grad
  ctx.fillText('AI', startX + tripWidth, y)

  return y
}

/** .wordmark-rule — the thin gradient divider under the wordmark. */
function rule(afterY) {
  const y = afterY + 36
  const w = 110
  const grad = ctx.createLinearGradient(W / 2 - w / 2, y, W / 2 + w / 2, y)
  grad.addColorStop(0, 'rgba(232,200,138,0)')
  grad.addColorStop(0.5, 'rgba(232,200,138,0.7)')
  grad.addColorStop(1, 'rgba(232,200,138,0)')
  ctx.strokeStyle = grad
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(W / 2 - w / 2, y)
  ctx.lineTo(W / 2 + w / 2, y)
  ctx.stroke()
  return y
}

/** .welcome-tagline — the Hebrew line under the rule. */
function tagline(afterY) {
  ctx.font = '500 30px "Rubik Medium"'
  ctx.fillStyle = '#78778A'
  ctx.textAlign = 'center'
  ctx.direction = 'rtl'
  ctx.fillText('תכנון טיולים חכם, בעברית', W / 2, afterY + 58)
}

aura()
mark()
const wordmarkY = wordmark()
const ruleY = rule(wordmarkY)
tagline(ruleY)

writeFileSync('public/og-image.png', canvas.toBuffer('image/png'))
console.log(`✔ wrote public/og-image.png (${W}x${H})`)
