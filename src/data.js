/** Mock trip data for the TripAI prototype — Paris, day 2 of 5. */

export const TRIP = {
  city: 'פריז',
  country: 'צרפת',
  temp: 22,
  weather: 'מעונן חלקית',
  day: 2,
  totalDays: 5,
  id: 'PAR-8F3K2',   // invite code shared over WhatsApp
}

export const TRAVEL_STYLES = [
  { id: 'chill', emoji: '🏖️', title: 'בטן גב', sub: 'רגוע, בלי לחץ' },
  { id: 'adventure', emoji: '🧗', title: 'הרפתקאות', sub: 'אקסטרים ואקשן' },
  { id: 'culture', emoji: '🏛️', title: 'תרבות והיסטוריה', sub: 'מוזיאונים ואתרים' },
  { id: 'food', emoji: '🍜', title: 'אוכל וקולינריה', sub: 'שווקים ומסעדות' },
]

export const BUDGETS = [
  { id: 'low', label: '$ - חסכוני' },
  { id: 'mid', label: '$$ - בינוני' },
  { id: 'high', label: '$$$ - יוקרתי' },
  { id: 'lux', label: '$$$$ - ללא גבולות' },
]

/** Stop categories drive both the pin color on the map and the card accent. */
export const CATEGORIES = {
  museum: { label: 'מוזיאון', color: '#7C3AED' },
  food: { label: 'מסעדה', color: '#FB7185' },
  walking: { label: 'הליכה', color: '#22D3EE' },
  landmark: { label: 'אתר', color: '#FBBF24' },
}

/** Real Paris coordinates — used by buildStaticMapUrl when a key is present,
 *  and projected onto the SVG map when it isn't. */
export const STOPS = [
  {
    id: 1,
    name: 'Café de Flore',
    he: 'קפה דה פלור',
    desc: 'ארוחת בוקר פריזאית קלאסית',
    time: '09:00',
    cat: 'food',
    who: ['f1', 'f2', 'f3'],
    rating: 4.5,
    lat: 48.85405,
    lng: 2.33249,
    x: 146,
    y: 566,
  },
  {
    id: 2,
    name: 'מוזיאון הלובר',
    he: 'מוזיאון הלובר',
    desc: 'סיור מודרך - האגף הצרפתי',
    time: '11:30',
    cat: 'museum',
    who: ['f1', 'f2'],
    rating: 4.8,
    lat: 48.86061,
    lng: 2.33764,
    x: 214,
    y: 430,
  },
  {
    id: 3,
    name: 'גני הטווילרי',
    he: 'גני הטווילרי',
    desc: 'הליכה רגועה בין הפסלים',
    time: '14:00',
    cat: 'walking',
    who: ['f2', 'f3'],
    rating: 4.6,
    lat: 48.86342,
    lng: 2.32725,
    x: 268,
    y: 344,
  },
  {
    id: 4,
    name: 'מגדל אייפל',
    he: 'מגדל אייפל',
    desc: 'שקיעה מהקומה השנייה',
    time: '18:30',
    cat: 'landmark',
    who: ['f1', 'f2', 'f3'],
    rating: 4.9,
    lat: 48.85837,
    lng: 2.29448,
    x: 330,
    y: 196,
  },
]

export const RECOMMENDATIONS = [
  { id: 'r1', title: 'שייט על הסן', sub: 'קרוב אליך · 12 דק׳ הליכה', emoji: '🚤', tint: '#22D3EE' },
  { id: 'r2', title: 'שוק ראספיי', sub: 'נסגר ב-14:00 · פתוח עכשיו', emoji: '🧺', tint: '#FBBF24' },
  { id: 'r3', title: 'מונמארטר בשקיעה', sub: 'מומלץ ע"י 89% מהמטיילים', emoji: '🎨', tint: '#FB7185' },
]

export const MEMBERS = [
  { id: 'u1', name: 'אתה', short: 'א', color: '#6366F1' },
  { id: 'u2', name: 'דנה', short: 'ד', color: '#FB7185' },
  { id: 'u3', name: 'יוסי', short: 'י', color: '#22D3EE' },
  { id: 'u4', name: 'מיכל', short: 'מ', color: '#FBBF24' },
  { id: 'u5', name: 'עומר', short: 'ע', color: '#34D399' },
]

/** Gallery thumbnails are CSS gradients — no external image requests. */
export const PHOTOS = Array.from({ length: 12 }, (_, i) => {
  const palettes = [
    ['#3B1E6E', '#6366F1'],
    ['#0A1B26', '#22D3EE'],
    ['#4C1D3D', '#FB7185'],
    ['#3F2D12', '#FBBF24'],
    ['#12331F', '#34D399'],
    ['#241B4A', '#7C3AED'],
  ]
  const [a, b] = palettes[i % palettes.length]
  return {
    id: `p${i}`,
    by: MEMBERS[(i + 1) % MEMBERS.length],
    grad: `linear-gradient(${135 + i * 17}deg, ${a}, ${b})`,
  }
})

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

export const EXPENSES = [
  { id: 'e1', title: 'ארוחת ערב - Le Comptoir', payer: 'u2', amount: 320, split: 4 },
  { id: 'e2', title: 'כרטיסים ללובר', payer: 'u1', amount: 204, split: 4 },
  { id: 'e3', title: 'מונית משדה התעופה', payer: 'u3', amount: 180, split: 3 },
]

/**
 * Travel parties. A trip can be split by person or by family: each stop lists
 * which parties are attending it, so two families can share one trip while
 * following partly different itineraries.
 */
export const FAMILIES = [
  { id: 'f1', name: 'משפחת כהן', short: 'כ', color: '#6366F1', members: ['u1', 'u4'], joined: true },
  { id: 'f2', name: 'דנה ויוסי', short: 'ד', color: '#FB7185', members: ['u2', 'u3'], joined: true },
  { id: 'f3', name: 'עומר', short: 'ע', color: '#34D399', members: ['u5'], joined: false },
]

/** Head count for a set of party ids. */
export const headCount = (ids) =>
  FAMILIES.filter((f) => ids.includes(f.id)).reduce((n, f) => n + f.members.length, 0)
