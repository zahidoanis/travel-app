/**
 * Static reference data only.
 *
 * There are no sample trips, stops, families, photos or expenses here. Every
 * screen renders what the user entered during onboarding or what the agent
 * produced — a placeholder itinerary is indistinguishable from a real one
 * that failed to load, which is a bad way to find out something is broken.
 */

/** Stop categories drive both the pin colour on the map and the card accent. */
export const CATEGORIES = {
  museum: { label: 'מוזיאון', color: '#6D4AC8' },
  food: { label: 'מסעדה', color: '#D14B68' },
  walking: { label: 'הליכה', color: '#0E8E9B' },
  landmark: { label: 'אתר', color: '#B5842A' },
}

export const TRAVEL_STYLES = [
  { id: 'chill', emoji: '🏖️', title: 'בטן גב', sub: 'רגוע, בלי לחץ' },
  { id: 'adventure', emoji: '🧗', title: 'הרפתקאות', sub: 'אקסטרים ואקשן' },
  { id: 'culture', emoji: '🏛️', title: 'תרבות והיסטוריה', sub: 'מוזיאונים ואתרים' },
  { id: 'food', emoji: '🍜', title: 'אוכל וקולינריה', sub: 'שווקים ומסעדות' },
  { id: 'nature', emoji: '🌿', title: 'טבע', sub: 'שבילים, פארקים ונופים' },
  { id: 'kids', emoji: '🧒', title: 'טיול עם ילדים', sub: 'קצב נוח ואטרקציות מתאימות' },
]

/** Cuisine preferences, asked during onboarding and used to filter
 *  restaurant recommendations. */
export const CUISINES = [
  { id: 'local', label: 'מטבח מקומי', emoji: '📍' },
  { id: 'italian', label: 'איטלקי', emoji: '🍝' },
  { id: 'asian', label: 'אסייתי', emoji: '🍜' },
  { id: 'seafood', label: 'דגים ופירות ים', emoji: '🦞' },
  { id: 'meat', label: 'בשרים', emoji: '🥩' },
  { id: 'vegan', label: 'צמחוני / טבעוני', emoji: '🌱' },
  { id: 'kosher', label: 'כשר', emoji: '✡️' },
  { id: 'street', label: 'אוכל רחוב', emoji: '🌮' },
  { id: 'fine', label: 'שף / מסעדות יוקרה', emoji: '🍷' },
  { id: 'cafe', label: 'בתי קפה ומאפיות', emoji: '☕' },
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

/** Suggested destinations on the first onboarding question. */
export const DESTINATIONS = [
  { id: 'paris', city: 'פריז', en: 'Paris', country: 'צרפת', emoji: '🗼' },
  { id: 'rome', city: 'רומא', en: 'Rome', country: 'איטליה', emoji: '🏛️' },
  { id: 'prague', city: 'פראג', en: 'Prague', country: 'צ׳כיה', emoji: '🏰' },
  { id: 'athens', city: 'אתונה', en: 'Athens', country: 'יוון', emoji: '🏺' },
  { id: 'barcelona', city: 'ברצלונה', en: 'Barcelona', country: 'ספרד', emoji: '🎨' },
  { id: 'bangkok', city: 'בנגקוק', en: 'Bangkok', country: 'תאילנד', emoji: '🛕' },
  { id: 'dubai', city: 'דובאי', en: 'Dubai', country: 'איחוד האמירויות', emoji: '🌇' },
  { id: 'london', city: 'לונדון', en: 'London', country: 'אנגליה', emoji: '☂️' },
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
