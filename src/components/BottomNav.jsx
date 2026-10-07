import { HomeIcon, AiSpark, Wallet, Route, Utensils, Plane, Bed, Layers, Printer, Ticket, Images } from './Icons'
import { t } from '../i18n'

/** The desktop rail shows everything; the bottom bar keeps a subset.
 *  `trips` isn't a routed screen — it opens the account sheet's trip
 *  switcher instead — so whatever renders this list needs to special-case
 *  its click rather than treating every id the same as a tab. */
export const RAIL_ONLY = [
  { id: 'food', label: t('מסעדות'), Icon: Utensils },
  { id: 'arrival', label: t('הגעה'), Icon: Plane },
  { id: 'hotels', label: t('מלונות'), Icon: Bed },
  { id: 'journal', label: t('יומן הטיול'), Icon: Images },
  { id: 'summary', label: t('סיכום להדפסה'), Icon: Printer },
  { id: 'trips', label: t('הטיולים שלי'), Icon: Layers },
]

// Five, not six: "home", "map" and "route" were three doors to the same
// itinerary. The map now lives inside the route tab (a list/map switch on a
// phone, side by side on a desktop), and the agent sits in the middle.
export const TABS = [
  { id: 'home', label: t('בית'), Icon: HomeIcon },
  { id: 'days', label: t('מסלול'), Icon: Route },
  { id: 'chat', label: t("צ'אט AI"), Icon: AiSpark },
  { id: 'reservations', label: t('הזמנות'), Icon: Ticket },
  { id: 'finance', label: t('הוצאות'), Icon: Wallet },
]

export default function BottomNav({ tab, onChange }) {
  // Restaurants, Arrival, Hotels and Summary are opened from Home's cards on
  // a phone; while one is open, Home stays lit so it is clear where "back"
  // is. aria-current stays truthful — it marks only the screen actually open.
  const lit = RAIL_ONLY.some((r) => r.id === tab) ? 'home' : tab
  return (
    // Navigation between screens, not a tab widget: role="tab" promises
    // arrow-key movement and a tabpanel per tab, neither of which exists
    // here, and a screen reader announces the mismatch.
    <nav className="nav" aria-label={t('ניווט ראשי')}>
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          aria-current={tab === id ? 'page' : undefined}
          className={`nav-item ${lit === id ? 'active' : ''}`}
          onClick={() => onChange(id)}
        >
          <span className="nav-glyph">
            <Icon size={20} />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
