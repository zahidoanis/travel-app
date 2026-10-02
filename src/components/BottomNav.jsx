import { Calendar, MapIcon, AiSpark, Wallet, Route, Utensils, Plane, Bed, Layers, Printer, Ticket } from './Icons'
import { t } from '../i18n'

/** The desktop rail shows everything; the bottom bar keeps a subset.
 *  `trips` isn't a routed screen — it opens the account sheet's trip
 *  switcher instead — so whatever renders this list needs to special-case
 *  its click rather than treating every id the same as a tab. */
export const RAIL_ONLY = [
  { id: 'food', label: t('מסעדות'), Icon: Utensils },
  { id: 'arrival', label: t('הגעה'), Icon: Plane },
  { id: 'hotels', label: t('מלונות'), Icon: Bed },
  { id: 'summary', label: t('סיכום להדפסה'), Icon: Printer },
  { id: 'trips', label: t('הטיולים שלי'), Icon: Layers },
]

export const TABS = [
  { id: 'home', label: t('בית/לו"ז'), Icon: Calendar },
  { id: 'map', label: t('מפה'), Icon: MapIcon },
  { id: 'chat', label: t("צ'אט AI"), Icon: AiSpark },
  { id: 'days', label: t('מסלול'), Icon: Route },
  { id: 'reservations', label: t('הזמנות'), Icon: Ticket },
  { id: 'finance', label: t('פיננסים'), Icon: Wallet },
]

export default function BottomNav({ tab, onChange }) {
  return (
    // Navigation between screens, not a tab widget: role="tab" promises
    // arrow-key movement and a tabpanel per tab, neither of which exists
    // here, and a screen reader announces the mismatch.
    <nav className="nav" aria-label={t('ניווט ראשי')}>
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          aria-current={tab === id ? 'page' : undefined}
          className={`nav-item ${tab === id ? 'active' : ''}`}
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
