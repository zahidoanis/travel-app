/**
 * UI language — Hebrew or English.
 *
 * Hebrew is the source language and doubles as the lookup key, gettext
 * style: every string in the code stays readable Hebrew wrapped in t(), and
 * English is one dictionary (locales/en.js) keyed by that exact Hebrew. A
 * missing English entry falls back to the Hebrew rather than to a blank or a
 * raw key, and `npm run i18n:check` lists every key the dictionary lacks.
 *
 * The language is fixed for the lifetime of a page load. Switching it
 * reloads, which is what lets `dir`/`lang` on <html> be right from the very
 * first paint and lets t() be a plain function that module-level code and
 * components alike can call, with no provider to thread through the tree.
 */

import en from './locales/en'

const KEY = 'tripai.lang'
export const LANGS = ['he', 'en']

function fromBrowser() {
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  return prefs.some((l) => /^(he|iw)\b/i.test(l ?? '')) ? 'he' : 'en'
}

function detect() {
  try {
    const saved = localStorage.getItem(KEY)
    if (LANGS.includes(saved)) return saved
    // First visit since English existed. Anyone with TripAI data already on
    // this device was using the app in Hebrew — keep them there instead of
    // flipping them to English just because their browser is set that way.
    let returning = false
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith('tripai.')) returning = true
    }
    const pick = returning ? 'he' : fromBrowser()
    // Remembered, so the answer can't drift on a later visit (e.g. once
    // telemetry has written its own tripai.* key for a new English user).
    localStorage.setItem(KEY, pick)
    return pick
  } catch {
    return fromBrowser() // private mode / storage blocked
  }
}

export const lang = detect()
export const isRTL = lang === 'he'
export const dir = isRTL ? 'rtl' : 'ltr'
/** For toLocaleDateString / Intl — the app's own language, not the device's. */
export const locale = lang === 'he' ? 'he-IL' : 'en-US'

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang
  document.documentElement.dir = dir
  // index.html's <title> is the Hebrew one (crawlers and share previews
  // read it before any script runs); the tab title follows the UI.
  if (lang === 'en') document.title = 'TripAI — Your travel assistant'
}

/** Persists the choice and reloads into it. */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* nothing to persist into — the reload below still applies it once */
  }
  location.reload()
}

/**
 * t('יום {n} מתוך {total}', { n: 2, total: 5 })
 * The Hebrew source text is both the key and the Hebrew output.
 */
export function t(source, vars) {
  const text = lang === 'en' ? (en[source] ?? source) : source
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

/**
 * English needs "1 traveler" / "3 travelers"; the Hebrew strings in this app
 * are written for the plural and read fine either way, so Hebrew just uses
 * the `many` form. Both forms are ordinary t() keys.
 */
export function tn(count, one, many, vars) {
  return t(lang === 'en' && Number(count) === 1 ? one : many, { n: count, ...vars })
}
