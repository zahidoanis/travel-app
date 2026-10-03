import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Tells the offline shell (public/sw.js) what this build is made of.
 *
 * It used to learn the files from index.html alone, so the screens loaded
 * on demand (the legal pages, the English dictionary, …) were cached only
 * once visited online — offline, they failed. This writes the full list to
 * asset-list.json, and stamps sw.js with a build id: a byte-identical
 * sw.js is never reinstalled, so without the stamp a deploy never reached
 * the worker at all.
 */
function offlineShell() {
  let files = []
  let outDir = 'dist'
  return {
    name: 'offline-shell',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    generateBundle(_, bundle) {
      files = Object.keys(bundle).filter((f) => f.startsWith('assets/')).map((f) => `/${f}`)
    },
    closeBundle() {
      const build = Date.now().toString(36)
      writeFileSync(join(outDir, 'asset-list.json'), JSON.stringify({ build, files }))
      const sw = join(outDir, 'sw.js')
      if (existsSync(sw)) writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD_ID__', build))
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  server: { port: 5173, open: true },
})
