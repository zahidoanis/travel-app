import { Calendar, MapIcon, Bot, Images, Wallet } from './Icons'

export const TABS = [
  { id: 'home', label: 'בית/לו"ז', Icon: Calendar },
  { id: 'map', label: 'מפה', Icon: MapIcon },
  { id: 'chat', label: "צ'אט AI", Icon: Bot },
  { id: 'gallery', label: 'גלריה', Icon: Images },
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
