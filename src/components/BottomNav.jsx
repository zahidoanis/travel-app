import { Calendar, MapIcon, Bot, Wallet, Route, Utensils, Plane } from './Icons'

/** The desktop rail shows everything; the bottom bar keeps a subset. */
export const RAIL_ONLY = [
  { id: 'days', label: 'מסלול', Icon: Route },
  { id: 'food', label: 'מסעדות', Icon: Utensils },
  { id: 'arrival', label: 'הגעה', Icon: Plane },
]

export const TABS = [
  { id: 'home', label: 'בית/לו"ז', Icon: Calendar },
  { id: 'map', label: 'מפה', Icon: MapIcon },
  { id: 'chat', label: "צ'אט AI", Icon: Bot },
  { id: 'finance', label: 'פיננסים', Icon: Wallet },
]

export default function BottomNav({ tab, onChange, onDebug }) {
  // Long-pressing the active tab opens the diagnostics log — no visible
  // affordance, so it stays out of the way of real users.
  let timer = null
  const holdStart = () => {
    timer = setTimeout(() => onDebug?.(), 900)
  }
  const holdEnd = () => clearTimeout(timer)

  return (
    <nav className="nav" role="tablist" aria-label="ניווט ראשי">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          className={`nav-item ${tab === id ? 'active' : ''}`}
          onClick={() => onChange(id)}
          onPointerDown={tab === id ? holdStart : undefined}
          onPointerUp={holdEnd}
          onPointerLeave={holdEnd}
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
