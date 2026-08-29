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
 *
 * `text` is expected to already contain the link — every caller builds it
 * that way, since the plain wa.me fallback below has no separate `url` slot
 * at all. The native Web Share API's own `url` field used to also be filled
 * in here alongside it, which put the exact same link in the shared message
 * twice: once as a plain line inside `text`, once again as its own entry —
 * the second one gets a real link-preview card (title fetched, thumbnail),
 * the first doesn't, so it read as two different links rather than one
 * appearing twice.
 */
export async function shareTrip(text) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: 'TripAI', text })
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
