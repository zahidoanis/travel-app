/**
 * Static reference data only.
 *
 * There are no sample trips, stops, families, photos or expenses here. Every
 * screen renders what the user entered during onboarding or what the agent
 * produced — a placeholder itinerary is indistinguishable from a real one
 * that failed to load, which is a bad way to find out something is broken.
 */

import { t } from './i18n'
/** Stop categories drive both the pin colour on the map and the card accent. */
export const CATEGORIES = {
  museum: { label: t('מוזיאון'), color: '#6D4AC8' },
  food: { label: t('מסעדה'), color: '#D14B68' },
  walking: { label: t('הליכה'), color: '#0E8E9B' },
  landmark: { label: t('אתר'), color: '#B5842A' },
}

export const TRAVEL_STYLES = [
  { id: 'chill', emoji: '🏖️', title: t('בטן גב'), sub: t('רגוע, בלי לחץ') },
  { id: 'adventure', emoji: '🧗', title: t('הרפתקאות'), sub: t('אקסטרים ואקשן') },
  { id: 'culture', emoji: '🏛️', title: t('תרבות והיסטוריה'), sub: t('מוזיאונים ואתרים') },
  { id: 'food', emoji: '🍜', title: t('אוכל וקולינריה'), sub: t('שווקים ומסעדות') },
  { id: 'nature', emoji: '🌿', title: t('טבע'), sub: t('שבילים, פארקים ונופים') },
  { id: 'kids', emoji: '🧒', title: t('טיול עם ילדים'), sub: t('קצב נוח ואטרקציות מתאימות') },
]

/** Cuisine preferences, asked during onboarding and used to filter
 *  restaurant recommendations. */
export const CUISINES = [
  { id: 'local', label: t('מטבח מקומי'), emoji: '📍' },
  { id: 'italian', label: t('איטלקי'), emoji: '🍝' },
  { id: 'asian', label: t('אסייתי'), emoji: '🍜' },
  { id: 'seafood', label: t('דגים ופירות ים'), emoji: '🦞' },
  { id: 'meat', label: t('בשרים'), emoji: '🥩' },
  { id: 'vegan', label: t('צמחוני / טבעוני'), emoji: '🌱' },
  { id: 'kosher', label: t('כשר'), emoji: '✡️' },
  { id: 'street', label: t('אוכל רחוב'), emoji: '🌮' },
  { id: 'fine', label: t('שף / מסעדות יוקרה'), emoji: '🍷' },
  { id: 'cafe', label: t('בתי קפה ומאפיות'), emoji: '☕' },
]

/** Colours handed out to travel parties as they are created. */
export const PARTY_COLORS = ['#5B4BD6', '#D14B68', '#0E8F5E', '#B5842A', '#0E8E9B', '#8B5CF6']

/** Head count for a set of party ids, within a given list of families. */
export const headCount = (ids, families = []) =>
  families.filter((f) => ids.includes(f.id)).reduce((n, f) => n + f.members.length, 0)

/**
 * A traveller within a party. Age arrived after the field already had real
 * data in it — every trip made before this shipped stored a member as a
 * bare name string, so both shapes have to keep working rather than
 * migrating every stored trip at once.
 */
export const memberName = (m) => (typeof m === 'string' ? m : m?.name ?? '')
export const memberAge = (m) => (typeof m === 'string' ? '' : m?.age ?? '')

/** Half-hour increments, all 48 of them — a plain <select> that commits the
 *  moment you pick something, rather than a native time input whose
 *  confirm gesture (or total absence of one) varies by platform. Nobody
 *  plans an arrival down to the minute anyway. */
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  const m = i % 2 === 0 ? '00' : '30'
  return `${h}:${m}`
})

/** Suggested destinations on the first onboarding question. */
export const DESTINATIONS = [
  { id: 'paris', city: t('פריז'), en: 'Paris', country: t('צרפת'), emoji: '🗼' },
  { id: 'rome', city: t('רומא'), en: 'Rome', country: t('איטליה'), emoji: '🏛️' },
  { id: 'prague', city: t('פראג'), en: 'Prague', country: t('צ׳כיה'), emoji: '🏰' },
  { id: 'athens', city: t('אתונה'), en: 'Athens', country: t('יוון'), emoji: '🏺' },
  { id: 'barcelona', city: t('ברצלונה'), en: 'Barcelona', country: t('ספרד'), emoji: '🎨' },
  { id: 'bangkok', city: t('בנגקוק'), en: 'Bangkok', country: t('תאילנד'), emoji: '🛕' },
  { id: 'dubai', city: t('דובאי'), en: 'Dubai', country: t('איחוד האמירויות'), emoji: '🌇' },
  { id: 'london', city: t('לונדון'), en: 'London', country: t('אנגליה'), emoji: '☂️' },
]

/** Indicative rates against ILS. In production these come from a rates API. */
export const RATES = {
  EUR: 4.025,
  USD: 3.71,
  CZK: 0.163,
  THB: 0.104,
  GBP: 4.71,
  AED: 1.01,
  CHF: 4.19,
  ILS: 1,
}

export const CURRENCIES = Object.keys(RATES)
