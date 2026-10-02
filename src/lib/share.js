/**
 * Sharing a trip over WhatsApp.
 *
 * WhatsApp's `wa.me` scheme is a plain https link — no SDK, no API key, no
 * Business API account. It opens the app (or WhatsApp Web on desktop) with the
 * message prefilled and lets the sender pick the chat. That is the whole
 * integration; nothing here costs anything.
 */

import { t } from '../i18n'
/**
 * Public URL of the app that joins this trip. `token` is the trip's
 * inviteToken; trips made before tokens existed have none, and their link is
 * the id alone until a member resets it.
 */
export function inviteUrl(tripId, token) {
  const base =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : ''
  const k = token ? `&k=${encodeURIComponent(token)}` : ''
  return `${base}?trip=${encodeURIComponent(tripId)}${k}`
}

/** Reads the invite code back out when someone opens a shared link. */
export function invitedTripId() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('trip')
}

/** The invite token from a shared link, if it carried one. */
export function invitedToken() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('k')
}

/**
 * The message body — itinerary preview plus the join code, deliberately
 * *without* the link itself. shareTrip() attaches the link separately, via
 * Web Share API's own `url` field, so WhatsApp unfurls it into a real
 * preview card (title, description, the branded image) instead of a bare
 * line of text.
 *
 * This used to include the link inline here too, alongside also passing it
 * as `url` — which put the same link in the shared message twice: once as
 * a plain line inside `text` (no preview), once again as `url`'s own entry
 * (real preview card). It read as two different links rather than one
 * showing up twice, which is why `url` was dropped entirely for a while —
 * but that traded away the preview card altogether, on every share, to fix
 * a cosmetic issue on some. Leaving the link out of `text` gets both: shown
 * once, and unfurled.
 */
export function inviteText(trip, stops, tripId) {
  const lines = stops.map((s) => `${s.time} · ${s.he}`)
  return [
    t('הצטרפו אליי לטיול ב{city}! 🗺️', { city: trip.city }),
    '',
    t('יום {day} מתוך {total}:', { day: trip.day, total: trip.totalDays }),
    ...lines,
    '',
    t('המסלול מתעדכן אצל כולם בזמן אמת — הקישור למטה מצרף אתכם לטיול.'),
  ].join('\n')
}

export const whatsappUrl = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`

/**
 * Prefer the OS share sheet where it exists (it lists WhatsApp alongside
 * everything else), and fall back to opening WhatsApp directly. Returns how
 * it was shared, so the UI can report accurately.
 *
 * `url` rides separately from `text` here on purpose — see inviteText's
 * comment. The `wa.me` fallback has no such second slot at all, though: a
 * message with no link anywhere in its one text field would be useless, so
 * that path alone stitches them back into one string.
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
  window.open(whatsappUrl(`${text}\n\n${url}`), '_blank', 'noopener')
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
