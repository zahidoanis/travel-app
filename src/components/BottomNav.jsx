import { Calendar, MapIcon, Bot, Wallet, Route, Utensils, Plane, Bed, Layers, Printer } from './Icons'

/** The desktop rail shows everything; the bottom bar keeps a subset.
 *  `trips` isn't a routed screen — it opens the account sheet's trip
 *  switcher instead — so whatever renders this list needs to special-case
 *  its click rather than treating every id the same as a tab. */
export const RAIL_ONLY = [
  { id: 'food', label: 'מסעדות', Icon: Utensils },
  { id: 'arrival', label: 'הגעה', Icon: Plane },
  { id: 'hotels', label: 'מלונות', Icon: Bed },
  { id: 'summary', label: 'סיכום להדפסה', Icon: Printer },
  { id: 'trips', label: 'הטיולים שלי', Icon: Layers },
]

export const TABS = [
  { id: 'home', label: 'בית/לו"ז', Icon: Calendar },
  { id: 'map', label: 'מפה', Icon: MapIcon },
  { id: 'chat', label: "צ'אט AI", Icon: Bot },
  { id: 'days', label: 'מסלול', Icon: Route },
  { id: 'finance', label: 'פיננסים', Icon: Wallet },
]

export default function BottomNav({ tab, onChange }) {
  return (
    <nav className="nav" role="tablist" aria-label="ניווט ראשי">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
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
