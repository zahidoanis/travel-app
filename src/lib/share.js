/**
 * Sharing a trip over WhatsApp.
 *
 * WhatsApp's `wa.me` scheme is a plain https link — no SDK, no API key, no
 * Business API account. It opens the app (or WhatsApp Web on desktop) with the
 * message prefilled and lets the sender pick the chat. That is the whole
 * integration; nothing here costs anything.
 */

/** Public URL of the app, with the invite code attached. */
export function inviteUrl(tripId) {
  const base =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : ''
  return `${base}?trip=${encodeURIComponent(tripId)}`
}

/** Reads the invite code back out when someone opens a shared link. */
export function invitedTripId() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('trip')
}

/**
 * Pulls a trip id out of whatever someone pasted into the "I have a code"
 * field — the bare id, or the whole shared link. There is only ever one
 * thing to share now (the link, which already contains the id), so the
 * field on the receiving end has to accept it in either form.
 */
export function extractTripId(input) {
  const trimmed = input.trim()
  try {
    return new URL(trimmed).searchParams.get('trip') ?? trimmed
  } catch {
    // Not a parseable URL — a protocol-less paste like "site.com/?trip=x"
    // still has the param in it even though `new URL` rejects it outright.
    const m = trimmed.match(/[?&]trip=([^&\s]+)/)
    return m ? decodeURIComponent(m[1]) : trimmed
  }
}

/** The message body — itinerary preview plus the join link. */
export function inviteText(trip, stops, tripId) {
  const lines = stops.map((s) => `${s.time} · ${s.he}`)
  return [
    `הצטרפו אליי לטיול ב${trip.city}! 🗺️`,
    '',
    `יום ${trip.day} מתוך ${trip.totalDays}:`,
    ...lines,
    '',
    'המסלול מתעדכן אצל כולם בזמן אמת:',
    inviteUrl(tripId),
    '',
    `קוד הצטרפות: ${tripId}`,
  ].join('\n')
}

export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`

/**
 * Prefer the OS share sheet where it exists (it lists WhatsApp alongside
 * everything else), and fall back to opening WhatsApp directly.
 * Returns how it was shared, so the UI can report accurately.
 */
export async function shareTrip(text, url) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: 'TripAI', text, url })
      return 'native'
    } catch (err) {
      // AbortError just means the user dismissed the sheet — not a failure.
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }
  window.open(whatsappUrl(text), '_blank', 'noopener')
  return 'whatsapp'
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
