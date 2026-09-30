/**
 * Keeps the English dictionary honest.
 *
 *   npm run i18n:check
 *
 * 1. Every t('…') / tn(n, '…', '…') key used in src/ must exist in
 *    src/locales/en.js — otherwise English mode silently shows Hebrew.
 * 2. Lists lines that still carry Hebrew outside a comment and outside any
 *    t() call — strings that were never wrapped at all. Some are legitimate
 *    (regexes matching Hebrew model output, telemetry text, Hebrew data
 *    fields); annotate those with `i18n-ignore` on the same line, or wrap a
 *    whole region (e.g. a prompt template literal) in comments containing
 *    `i18n-ignore-start` and `i18n-ignore-end`.
 *
 * Files marked `i18n-ignore-file` near the top are skipped (bilingual lookup
 * data, not UI). cities.js is skipped too: it's generated bilingual data
 * (he/en per city), not UI.
 *
 * Exits 1 when any key is missing, so it can gate a build.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// fileURLToPath, not .pathname — the repo lives under "My Apps", and the
// raw pathname keeps the space percent-encoded.
const root = fileURLToPath(new URL('..', import.meta.url))
const src = join(root, 'src')
const { default: en } = await import(pathToFileURL(join(src, 'locales', 'en.js')).href)

const HEB = /[֐-׿]/
const STR = String.raw`(['"\`])((?:\\.|(?!\1)[^\\])*)\1`
const T_CALL = new RegExp(String.raw`\bt\(\s*` + STR, 'g')
const TN_CALL = new RegExp(String.raw`\btn\([^,]+,\s*` + STR + String.raw`\s*,\s*` + STR.replace('\\1', '\\3').replace('\\1', '\\3'), 'g')

const files = []
;(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      if (f !== 'locales') walk(p)
    } else if (/\.(jsx?|mjs)$/.test(f) && f !== 'i18n.js' && f !== 'cities.js') {
      files.push(p)
    }
  }
})(src)

const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n')
const missing = new Map() // key -> [file:line]
const unwrapped = []
const used = new Set()

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(root, file)
  // Whole-file opt-out for pure lookup data (see lib/currency.js).
  if (text.slice(0, 400).includes('i18n-ignore-file')) continue

  const note = (key, index) => {
    used.add(key)
    if (!(key in en)) {
      const line = text.slice(0, index).split('\n').length
      if (!missing.has(key)) missing.set(key, [])
      missing.get(key).push(`${rel}:${line}`)
    }
  }
  for (const m of text.matchAll(T_CALL)) note(unescape(m[2]), m.index)
  for (const m of text.matchAll(TN_CALL)) {
    note(unescape(m[2]), m.index)
    note(unescape(m[4]), m.index)
  }

  let inBlock = false
  let ignoring = false // between i18n-ignore-start / i18n-ignore-end
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim()
    if (line.includes('i18n-ignore-start')) { ignoring = true; return }
    if (line.includes('i18n-ignore-end')) { ignoring = false; return }
    if (ignoring) return
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      return
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return
    if (line.includes('i18n-ignore')) return
    const code = line.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '')
    if (!HEB.test(code)) return
    // Strip every t()/tn() call; whatever Hebrew is left was never wrapped.
    const rest = code.replace(T_CALL, '').replace(TN_CALL, '')
    if (HEB.test(rest)) unwrapped.push(`${rel}:${i + 1}  ${trimmed.slice(0, 110)}`)
  })
}

const unused = Object.keys(en).filter((k) => !used.has(k))

if (unwrapped.length) {
  console.log(`\n⚠ ${unwrapped.length} line(s) with Hebrew outside t():\n`)
  for (const u of unwrapped) console.log('  ' + u)
}
if (unused.length) {
  console.log(`\n· ${unused.length} dictionary entr${unused.length === 1 ? 'y' : 'ies'} no longer used:\n`)
  for (const k of unused) console.log('  ' + JSON.stringify(k))
}
if (missing.size) {
  console.log(`\n✖ ${missing.size} key(s) missing from src/locales/en.js:\n`)
  for (const [k, where] of missing) console.log(`  ${JSON.stringify(k)}  (${where.join(', ')})`)
  console.log()
  process.exit(1)
}
console.log(`\n✔ all ${used.size} t() keys have an English entry\n`)
