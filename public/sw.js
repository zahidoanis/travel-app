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
 */

const CACHE = 'tripai-shell-v1'
// Old asset versions linger after each deploy; anything not used for this
// long is dropped.
const MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000

// The files the page itself loads were fetched before this worker existed,
// so none of them went through it. Read them out of index.html and keep them
// now — otherwise the first visit would leave nothing usable offline.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const page = await fetch('/', { cache: 'no-store' })
    const html = await page.clone().text()
    await cache.put('/', page)
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1])
    await cache.addAll([...new Set([...assets, '/manifest.webmanifest', '/favicon.png'])])
  })())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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

async function networkFirst(request) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      // Every page of this app is the same index.html (the hosting rewrites
      // every path to it), so one cached copy under "/" serves them all.
      const key = request.mode === 'navigate' ? '/' : request
      cache.put(key, response.clone())
      if (request.mode === 'navigate') prune(cache)
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
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function prune(cache) {
  try {
    const now = Date.now()
    for (const request of await cache.keys()) {
      if (!new URL(request.url).pathname.startsWith('/assets/')) continue
      const response = await cache.match(request)
      const date = Date.parse(response?.headers.get('date') ?? '')
      if (Number.isFinite(date) && now - date > MAX_AGE_MS) await cache.delete(request)
    }
  } catch {
    /* pruning is housekeeping; never let it fail a page load */
  }
}
