import { Bell, CloudSun } from './Icons'
import { useTrip } from '../TripProvider'

/**
 * Three variants, matching the screens:
 *   "home"     — weather on the start edge + "מסונכרן" badge on the end edge
 *   "centered" — bell / centred title / weather cloud   (map, gallery, chat)
 *   "brand"    — TripAI wordmark on the end edge        (finance)
 */
export default function TopBar({ variant = 'centered', floating = false, onBell }) {
  const { trip: TRIP } = useTrip()
  const label = (
    <span className="topbar-title">
      {TRIP.city}, <span className="num">{TRIP.temp}°C</span>
    </span>
  )

  const bell = (
    <button className="icon-btn bell" onClick={onBell} aria-label="התראות">
      <Bell size={19} />
      <i className="bell-dot" />
    </button>
  )

  const cloud = (
    <span style={{ color: 'var(--muted)' }} aria-label={TRIP.weather}>
      <CloudSun size={21} />
    </span>
  )

  if (variant === 'home') {
    return (
      <header className={`topbar ${floating ? 'floating' : ''}`}>
        <div className="row" style={{ gap: 8 }}>
          {cloud}
          {label}
          {bell}
        </div>
        <span className="badge badge-live">
          <i className="dot dot-amber dot-pulse" />
          מסונכרן
        </span>
      </header>
    )
  }

  if (variant === 'brand') {
    return (
      <header className={`topbar ${floating ? 'floating' : ''}`}>
        <div className="row" style={{ gap: 8 }}>
          {bell}
          {cloud}
          {label}
        </div>
        <span className="brand">TripAI</span>
      </header>
    )
  }

  return (
    <header className={`topbar ${floating ? 'floating' : ''}`}>
      {cloud}
      {label}
      {bell}
    </header>
  )
}
