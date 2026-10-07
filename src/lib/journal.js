/**
 * The trip journal — notes and photos, kept on this device only.
 *
 * IndexedDB, not localStorage: a few phone photos would fill localStorage's
 * ~5MB in one go. Photos are shrunk before they're stored (long side 1280px,
 * JPEG) so a journal of a hundred photos stays around 20-30MB.
 *
 * Nothing leaves the phone — no server copy, no sync. The price is that the
 * journal lives and dies with this browser's storage, so the first save also
 * asks the browser not to evict it (navigator.storage.persist).
 *
 * Entry:  { id, tripId, day, stopName?, note, photoIds[], at }
 * Photo:  { id, blob }
 */

const DB = 'tripai-journal'
let opened = null

function db() {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('entries', { keyPath: 'id' }).createIndex('tripId', 'tripId')
      d.createObjectStore('photos', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return opened
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = () => reject(tx.error)
  tx.onabort = () => reject(tx.error)
})
const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

export const newId = () =>
  typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export async function listEntries(tripId) {
  const d = await db()
  const rows = await result(d.transaction('entries').objectStore('entries').index('tripId').getAll(tripId))
  return rows.sort((a, b) => a.day - b.day || a.at - b.at)
}

/** Saves an entry and any new photo blobs `{id, blob}` in one transaction. */
export async function saveEntry(entry, newPhotos = [], removedPhotoIds = []) {
  const d = await db()
  const tx = d.transaction(['entries', 'photos'], 'readwrite')
  for (const p of newPhotos) tx.objectStore('photos').put(p)
  for (const id of removedPhotoIds) tx.objectStore('photos').delete(id)
  tx.objectStore('entries').put(entry)
  await done(tx)
  // Ask not to be cleared when the phone is short on space — best effort.
  navigator.storage?.persist?.().catch(() => {})
}

export async function deleteEntry(entry) {
  const d = await db()
  const tx = d.transaction(['entries', 'photos'], 'readwrite')
  for (const id of entry.photoIds ?? []) tx.objectStore('photos').delete(id)
  tx.objectStore('entries').delete(entry.id)
  await done(tx)
}

export async function getPhoto(id) {
  const d = await db()
  const row = await result(d.transaction('photos').objectStore('photos').get(id))
  return row?.blob ?? null
}

/** Removes everything this device holds for a trip (its journal). */
export async function clearJournal(tripId) {
  const entries = await listEntries(tripId)
  for (const e of entries) await deleteEntry(e)
}

/**
 * A picked photo, shrunk: long side at most 1280px, JPEG at 0.82. Phone
 * photos are 3-8MB; this is ~150-300KB and still sharp on a phone screen.
 */
export async function shrinkPhoto(file, maxSide = 1280, quality = 0.82) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode photo'))), 'image/jpeg', quality)
  )
}
