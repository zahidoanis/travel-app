import { complete } from './gemini'
import { dir } from '../i18n'

/**
 * A slideshow video made on the phone from journal photos: a title card, each
 * photo with a slow zoom and a short caption, an end card, and a music bed.
 * Nothing is uploaded — frames are drawn on a canvas and recorded with
 * MediaRecorder, so the file stays on the device until the person shares it.
 *
 * It records in real time (a 30s video takes ~30s) because that's the only
 * encoder every phone browser has; the screen has to stay on meanwhile.
 */

export const MUSIC = {
  // All public domain or CC0 recordings (Wikimedia Commons), 100s trimmed.
  calm: { url: '/music/calm.m4a', credit: 'Satie · Gymnopédie No. 1 (CC0)', about: 'gentle piano; France, cities, romantic, anywhere' },
  spain: { url: '/music/spain.m4a', credit: 'Albéniz · Leyenda (public domain)', about: 'Spanish guitar; Spain, Portugal, Latin America' },
  italy: { url: '/music/italy.m4a', credit: 'Tarantella (public domain)', about: 'bright Italian folk dance; Italy, Greece, Mediterranean islands' },
  lively: { url: '/music/lively.m4a', credit: 'Brahms · Hungarian Dance No. 1 (public domain)', about: 'energetic strings; Central and Eastern Europe, Balkans, Turkey' },
  nordic: { url: '/music/nordic.m4a', credit: 'Grieg · Morning Mood (public domain)', about: 'sweeping orchestral; Nordic countries, mountains, nature, Alps' },
}

const FALLBACK = [
  [/ספרד|פורטוגל|spain|portugal|mexico|argentin|brazil|colombia|peru|cuba/i, 'spain'],
  [/איטליה|יוון|קפריסין|מלטה|italy|greece|cyprus|malta|croatia/i, 'italy'],
  [/הונגריה|צ'כיה|פולין|רומניה|בולגריה|סרביה|טורקיה|אוסטריה|hungary|czech|poland|romania|bulgaria|serbia|turkey|austria|georgia|prague|budapest/i, 'lively'],
  [/נורווגיה|שוודיה|דנמרק|פינלנד|איסלנד|שווייץ|norway|sweden|denmark|finland|iceland|switzerland|nepal|peru/i, 'nordic'],
]

/** Which track suits the destination: the model picks, a country list backs it up. */
export async function pickMusic(city, country) {
  const place = `${city} ${country || ''}`.trim()
  try {
    const list = Object.entries(MUSIC).map(([k, v]) => `${k}: ${v.about}`).join('\n')
    const text = await complete({
      prompt: `Destination: ${place}. Pick the one music track that best fits it from this list. Answer with the key only.\n\n${list}`,
      system: 'You choose background music for travel videos.',
      kind: 'caption',
      maxTokens: 64,
    })
    const key = String(text).toLowerCase().match(/(calm|spain|italy|lively|nordic)/)?.[1]
    if (key) return key
  } catch { /* fall through */ }
  return FALLBACK.find(([re]) => re.test(place))?.[1] ?? 'calm'
}

const W = 720
const H = 1280
const FPS = 30
const SLIDE = 3.4        // seconds per photo, including the cross-fade
const FADE = 0.7
const INTRO = 2.6
const OUTRO = 2.4
export const MAX_PHOTOS = 12

/** The container the browser can actually write, MP4 first (WhatsApp, iPhone). */
export function pickFormat() {
  if (typeof MediaRecorder === 'undefined') return null
  const options = [
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
  ]
  for (const [mime, ext] of options) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  }
  return null
}

export const canMakeVideo = () =>
  Boolean(pickFormat()) && typeof HTMLCanvasElement !== 'undefined' &&
  typeof HTMLCanvasElement.prototype.captureStream === 'function'

/**
 * One short caption per item, written by the model from the stop and the
 * person's own note. Any failure just returns the plain fallbacks — the video
 * is still made, only less polished.
 */
export async function writeCaptions(items, city) {
  const fallback = items.map((i) => i.stopName || i.note?.split(/[.\n]/)[0]?.slice(0, 40) || '')
  try {
    const lang = dir === 'rtl' ? 'Hebrew' : 'English'
    const lines = items.map((i, n) => `${n + 1}. place: ${i.stopName || '-'}; note: ${(i.note || '-').slice(0, 160)}`).join('\n')
    const text = await complete({
      prompt: `Trip to ${city}. For each numbered item write ONE warm, vivid caption for a photo slideshow: at most 6 words, in ${lang}, no emoji, no quotes, no hashtags. Use the person's own note when there is one. Answer with exactly ${items.length} lines in the form "1. caption", nothing else.\n\n${lines}`,
      system: 'You write short, human captions for travel photo slideshows.',
      kind: 'caption',
      maxTokens: 1024,
    })
    const out = [...fallback]
    for (const line of String(text).split('\n')) {
      const m = line.match(/^\s*(\d+)[.)]\s*(.+?)\s*$/)
      if (m && out[Number(m[1]) - 1] !== undefined) out[Number(m[1]) - 1] = m[2].replace(/^["“]|["”]$/g, '')
    }
    return out
  } catch {
    return fallback
  }
}

const loadBitmap = (blob) => createImageBitmap(blob)

function wrap(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && ctx.measureText(next).width > maxWidth) { lines.push(cur); cur = w } else cur = next
  }
  if (cur) lines.push(cur)
  return lines.slice(0, maxLines)
}

function drawText(ctx, text, y, size, { weight = 700, maxLines = 3, alpha = 1 } = {}) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.direction = dir === 'rtl' ? 'rtl' : 'ltr'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${weight} ${size}px system-ui, "Segoe UI", Arial, sans-serif`
  ctx.fillStyle = '#fff'
  ctx.shadowColor = 'rgba(0,0,0,.55)'
  ctx.shadowBlur = 14
  const lines = wrap(ctx, text, W - 110, maxLines)
  const lh = size * 1.3
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + (i - (lines.length - 1) / 2) * lh))
  ctx.restore()
}

/** A photo filling the frame: blurred copy behind, the whole photo on top, slow zoom. */
function drawPhoto(ctx, bmp, p, alpha) {
  ctx.save()
  ctx.globalAlpha = alpha
  const cover = Math.max(W / bmp.width, H / bmp.height)
  ctx.filter = 'blur(28px) brightness(.7)'
  ctx.drawImage(bmp, (W - bmp.width * cover) / 2, (H - bmp.height * cover) / 2, bmp.width * cover, bmp.height * cover)
  ctx.filter = 'none'
  const fit = Math.min(W / bmp.width, (H * 0.78) / bmp.height) * (1 + 0.07 * p)
  const w = bmp.width * fit
  const h = bmp.height * fit
  ctx.beginPath()
  ctx.rect(0, 0, W, H)
  ctx.clip()
  ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2 - 30, w, h)
  ctx.restore()
}

function backdrop(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#3a2a1c')
  g.addColorStop(1, '#8F5F36')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

/**
 * @param {{ photos: {blob: Blob, caption: string}[], title: string, subtitle: string,
 *           endLine: string, music?: keyof typeof MUSIC, onProgress?: (n: number) => void,
 *           signal?: AbortSignal }} opts
 * @returns {Promise<{ blob: Blob, ext: string, mime: string, seconds: number }>}
 */
export async function makeVideo({ photos, title, subtitle, endLine, music = 'calm', onProgress, signal }) {
  const fmt = pickFormat()
  if (!fmt) throw new Error('no-recorder')
  const shots = photos.slice(0, MAX_PHOTOS)
  const bitmaps = await Promise.all(shots.map((s) => loadBitmap(s.blob)))

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Audio: the music runs through WebAudio into the same stream as the picture.
  const AC = window.AudioContext || window.webkitAudioContext
  const ac = new AC()
  const dest = ac.createMediaStreamDestination()
  const total = INTRO + shots.length * SLIDE + OUTRO
  let musicNode = null
  try {
    const res = await fetch(MUSIC[music].url)
    const buf = await ac.decodeAudioData(await res.arrayBuffer())
    musicNode = ac.createBufferSource()
    musicNode.buffer = buf
    musicNode.loop = true
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, ac.currentTime)
    gain.gain.linearRampToValueAtTime(1, ac.currentTime + 1.2)
    gain.gain.setValueAtTime(1, ac.currentTime + total - 2)
    gain.gain.linearRampToValueAtTime(0.0001, ac.currentTime + total)
    musicNode.connect(gain).connect(dest)
  } catch {
    musicNode = null // silent video beats no video
  }

  const stream = canvas.captureStream(FPS)
  dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr))
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 3_500_000, audioBitsPerSecond: 128_000 })
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise((resolve, reject) => {
    rec.onstop = resolve
    rec.onerror = (e) => reject(e.error || new Error('record'))
  })

  const frame = (t) => {
    backdrop(ctx)
    if (t < INTRO) {
      const a = Math.min(1, t / 0.6)
      drawText(ctx, title, H / 2 - 40, 64, { maxLines: 2, alpha: a })
      drawText(ctx, subtitle, H / 2 + 70, 30, { weight: 500, maxLines: 1, alpha: a })
      return
    }
    const st = t - INTRO
    const idx = Math.min(shots.length - 1, Math.floor(st / SLIDE))
    if (st >= shots.length * SLIDE) {
      const a = Math.min(1, (st - shots.length * SLIDE) / 0.6)
      drawText(ctx, endLine, H / 2 - 20, 44, { maxLines: 2, alpha: a })
      drawText(ctx, 'TripAI', H / 2 + 90, 28, { weight: 600, maxLines: 1, alpha: a })
      drawText(ctx, MUSIC[music].credit, H - 70, 18, { weight: 400, maxLines: 1, alpha: a * 0.8 })
      return
    }
    const local = st - idx * SLIDE
    if (local < FADE && idx > 0) drawPhoto(ctx, bitmaps[idx - 1], 1, 1)
    drawPhoto(ctx, bitmaps[idx], local / SLIDE, idx > 0 ? Math.min(1, local / FADE) : Math.min(1, local / 0.5))
    const cap = shots[idx].caption
    if (cap) {
      ctx.save()
      const g = ctx.createLinearGradient(0, H - 340, 0, H)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,.6)')
      ctx.fillStyle = g
      ctx.fillRect(0, H - 340, W, 340)
      ctx.restore()
      drawText(ctx, cap, H - 150, 44, { maxLines: 2, alpha: Math.min(1, Math.max(0, (local - 0.3) / 0.4)) })
    }
  }

  frame(0)
  rec.start(500)
  if (ac.state === 'suspended') await ac.resume()
  musicNode?.start()
  const t0 = performance.now()

  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000
      if (signal?.aborted || t >= total) return resolve()
      frame(t)
      onProgress?.(t / total)
      requestAnimationFrame(tick)
    }
    tick()
  })

  frame(total)
  rec.stop()
  try { musicNode?.stop() } catch { /* already stopped */ }
  await done
  ac.close().catch(() => {})
  bitmaps.forEach((b) => b.close?.())
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const blob = new Blob(chunks, { type: fmt.mime.split(';')[0] })
  return { blob, ext: fmt.ext, mime: blob.type, seconds: Math.round(total) }
}
