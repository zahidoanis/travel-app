import { useEffect, useRef, useState } from 'react'
import Sheet from './Sheet'
import { Ticket, X } from './Icons'
import { loadTicketPhoto, saveTicketPhoto, deleteTicketPhoto } from '../lib/db'
import { hasFirebase } from '../lib/firebase'
import { record } from '../lib/telemetry'

/**
 * A photo of the real ticket — boarding pass, attraction voucher, whatever
 * was actually issued — attached to one reservation. Not a generated
 * barcode: only the code the airline or venue actually issued scans at
 * their own reader, so a photo of the real thing is the only version worth
 * keeping. Self-contained: it loads, saves and deletes its own Firestore
 * document (trips/{tripId}/tickets/{ticketId}) rather than routing the
 * image through the reservation record, which shares a document with every
 * other reservation, note and expense on the trip.
 */

// Downscaled and re-encoded client-side so the stored string stays well
// inside a Firestore document's 1MB cap — a phone photo straight off the
// camera can be several MB, most of it resolution nobody needs to read a
// boarding pass. Quality steps down until the result fits comfortably.
async function toCompressedDataUrl(file, maxDimension = 1400, targetBytes = 650000) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = objectUrl
    })

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)

    let quality = 0.75
    let dataUrl = canvas.toDataURL('image/jpeg', quality)
    while (dataUrl.length * 0.75 > targetBytes && quality > 0.3) {
      quality -= 0.1
      dataUrl = canvas.toDataURL('image/jpeg', quality)
    }
    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export default function TicketPhoto({ tripId, ticketId }) {
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (hasFirebase && tripId && ticketId) {
      loadTicketPhoto(tripId, ticketId).then((url) => { if (!cancelled) setPhoto(url) })
    }
    return () => { cancelled = true }
  }, [tripId, ticketId])

  if (!hasFirebase || !tripId) return null

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const dataUrl = await toCompressedDataUrl(file)
      await saveTicketPhoto(tripId, ticketId, dataUrl)
      setPhoto(dataUrl)
    } catch (err) {
      record({ kind: 'db', message: `ticket photo: ${err?.message ?? err}`, stack: err?.stack })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setViewing(false)
    await deleteTicketPhoto(tripId, ticketId)
    setPhoto(null)
  }

  return (
    <>
      <input
        ref={inputRef} type="file" accept="image/*" capture="environment"
        style={{ display: 'none' }} onChange={onFile}
      />

      {photo ? (
        <button
          className="icon-btn" style={{ width: 30, height: 30, padding: 0, overflow: 'hidden' }}
          onClick={() => setViewing(true)}
          aria-label="הצג את הכרטיס"
        >
          <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </button>
      ) : (
        <button
          className="icon-btn" style={{ width: 30, height: 30 }}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="צרף תמונה של הכרטיס"
        >
          {busy ? <span className="typing"><i /><i /><i /></span> : <Ticket size={14} />}
        </button>
      )}

      <Sheet open={viewing} title="הכרטיס שלך" onClose={() => setViewing(false)}>
        {photo && (
          <img src={photo} alt="" style={{ width: '100%', borderRadius: 'var(--r-md)', marginBottom: 16 }} />
        )}
        <button className="btn btn-ghost btn-block" onClick={remove}>
          <X size={16} /> הסר תמונה
        </button>
      </Sheet>
    </>
  )
}
