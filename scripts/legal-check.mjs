/**
 * Refuses to call the legal pages ready while they still have holes in them.
 *
 *   npm run legal:check
 *
 * 1. Every required field in src/legal/operator.js must be filled in — an
 *    empty one renders as a "[missing]" marker on a public page, and a
 *    privacy policy that does not say who runs the site, or an accessibility
 *    statement with nobody to contact, does not do its job.
 * 2. Every document must exist in both languages, since the page picks the
 *    file by the UI language.
 *
 * Exits 1 on any problem, so it can gate a deploy:
 *   npm run legal:check && npm run build && firebase deploy --only hosting
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const legal = join(root, 'src', 'legal')

const { OPERATOR, REQUIRED_FIELDS, LAST_UPDATED } = await import(
  pathToFileURL(join(legal, 'operator.js')).href
)

const problems = []

for (const field of REQUIRED_FIELDS) {
  if (!String(OPERATOR[field] ?? '').trim()) problems.push(`operator.js: "${field}" is empty`)
}
if (OPERATOR.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(OPERATOR.email)) {
  problems.push(`operator.js: "${OPERATOR.email}" does not look like an email address`)
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(LAST_UPDATED)) {
  problems.push(`operator.js: LAST_UPDATED must be YYYY-MM-DD, got "${LAST_UPDATED}"`)
}

for (const doc of ['privacy', 'terms', 'accessibility']) {
  for (const language of ['he', 'en']) {
    const file = `${doc}.${language}.jsx`
    if (!existsSync(join(legal, file))) problems.push(`missing document: src/legal/${file}`)
  }
}

if (problems.length) {
  console.log(`\n✖ the legal pages are not ready to publish:\n`)
  for (const p of problems) console.log('  ' + p)
  console.log('\n  Fill in src/legal/operator.js — see LEGAL.md.\n')
  process.exit(1)
}
console.log(`\n✔ legal pages complete (last updated ${LAST_UPDATED})\n`)
