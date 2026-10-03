/**
 * Offline shell.
 *
 * The trip itself already works offline — Firestore keeps a copy in
 * IndexedDB (see lib/firebase.js). What did not was the app: with no
 * connection there was no page to load that copy into, so a traveller
 * abroad without data saw nothing at all. This keeps the last version of the
 * app's own files, and only those:
 *
 *   - pages: network first, so a new deploy is picked up the moment there is
 *     a connection; the cached copy only when there is none;
 *   - /assets/*: cache first — Vite names them by content hash, so a cached
 *     file can never be stale;
 *   - everything else (Firebase, the AI proxy, map tiles, photos, weather)
 *     is not touched at all and behaves exactly as without this file.
 *
 * Which files make up the app comes from asset-list.json, written by the
 * build (see vite.config.js), which also stamps BUILD below — so every
 * deploy is a new worker that caches every file of the new version.
 */

const BUILD = '__BUILD_ID__'
const CACHE = 'tripai-shell-v1'
// Files of earlier versions are kept this long after a newer one arrives,
// for a tab still open on the old version that loads one of its screens.
const KEEP_OLD_MS = 7 * 24 * 60 * 60 * 1000

async function fileList() {
  try {
    const res = await fetch('/asset-list.json', { cache: 'no-store' })
    return res.ok ? (await res.json()).files ?? [] : []
  } catch {
    return []
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const page = await fetch('/', { cache: 'no-store' })
    const html = await page.clone().text()
    await cache.put('/', page)
    // The list, plus whatever index.html names (in case the list is missing).
    const named = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
    const files = [...new Set([...(await fileList()), ...named, '/manifest.webmanifest', '/favicon.png'])]
    // One at a time, skipping failures: addAll() fails the whole install
    // over a single file, which left nothing cached at all.
    await Promise.all(files.map(async (f) => {
      if (await cache.match(f)) return
      try {
        const res = await fetch(f)
        if (isFile(f, res)) await cache.put(f, res)
      } catch { /* that file stays online-only */ }
    }))
    await cache.put('/__build', new Response(JSON.stringify({ build: BUILD, files, at: Date.now() })))
  })())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(prune)
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Firebase's own pages (Google sign-in) are never the app's to cache.
  if (url.pathname.startsWith('/__/')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }
  event.respondWith(networkFirst(request))
})

/**
 * Whether a response really is the file asked for. The hosting answers a
 * file that no longer exists (an old version's, after a deploy) with
 * index.html and status 200 — cached under a script's name, that page then
 * broke the app on every later load.
 */
function isFile(path, response) {
  if (!response?.ok) return false
  const type = response.headers.get('content-type') ?? ''
  return !(type.includes('text/html') && !String(path).endsWith('.html'))
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    const navigate = request.mode === 'navigate'
    if (navigate ? response.ok : isFile(new URL(request.url).pathname, response)) {
      // Every page of this app is the same index.html (the hosting rewrites
      // every path to it), so one cached copy under "/" serves them all.
      cache.put(navigate ? '/' : request, response.clone())
    }
    return response
  } catch (err) {
    const cached = await cache.match(request.mode === 'navigate' ? '/' : request)
    if (cached) return cached
    throw err
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (isFile(new URL(request.url).pathname, response)) cache.put(request, response.clone())
  return response
}

/**
 * Drops files that belong to no version in use. The current version's files
 * are never dropped, however old — they used to be, after 45 days without a
 * deploy, and offline the app then had nothing to load them from.
 */
async function prune() {
  try {
    const cache = await caches.open(CACHE)
    const info = await (await cache.match('/__build'))?.json()
    if (!info?.files?.length) return
    const current = new Set(info.files)
    const now = Date.now()
    for (const request of await cache.keys()) {
      const path = new URL(request.url).pathname
      if (!path.startsWith('/assets/') || current.has(path)) continue
      const response = await cache.match(request)
      const date = Date.parse(response?.headers.get('date') ?? '')
      if (!Number.isFinite(date) || now - date > KEEP_OLD_MS) await cache.delete(request)
    }
  } catch {
    /* pruning is housekeeping; never let it fail anything */
  }
}
