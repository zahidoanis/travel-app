/**
 * Which visual theme the app renders in.
 *
 *   'cream'   — Cream & Gold ("שמנת וזהב"), the light version of Golden
 *               Hour, chosen 2026-09-30. theme-cream.css.
 *   'gold'    — Golden Hour ("שעת זהב"), the warm canvas mockup on a dark
 *               espresso ground. theme-gold.css, scoped to [data-theme="gold"].
 *   'night'   — Electric Night, chosen 2026-09-30 from the design canvas.
 *               Lives entirely in theme-night.css, scoped to
 *               [data-theme="night"], layered over styles.css.
 *   'classic' — the previous light design, untouched in styles.css.
 *
 * Switching is changing this one value. The classic design is also tagged
 * in git as `design-classic` (and kept on the branch `design/classic`).
 */
export const THEME = 'cream'

// Status-bar / browser-chrome colour per theme — a light bar above a dark app
// (or the reverse) reads as a seam at the top of the phone.
const CHROME = { cream: '#FBF6EE', gold: '#2B2124', night: '#08070E', classic: '#FAFAFB' }

if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = THEME
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[THEME] ?? CHROME.classic)
}
