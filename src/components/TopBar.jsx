import { Bell, MapPin } from './Icons'
import { useTrip } from '../TripProvider'

/**
 * Three variants, matching the screens:
 *   "home"     — destination on the start edge, sync badge on the end edge
 *   "centered" — bell / destination / spacer   (map, gallery, chat)
 *   "brand"    — TripAI wordmark on the end edge (finance)
 *
 * The weather readout that used to sit here was invented — no provider is
 * wired up — so it is gone rather than showing a number nobody measured.
 */
export default function TopBar({ variant = 'centered', floating = false, onBell }) {
  const { trip } = useTrip()

  const label = (
    <span className="topbar-title">
      {trip ? trip.city : 'TripAI'}
      {trip?.country ? <span className="tiny"> · {trip.country}</span> : null}
    </span>
  )

  const bell = (
    <button className="icon-btn bell" onClick={onBell} aria-label="התראות">
      <Bell size={19} />
    </button>
  )

  const pin = (
    <span style={{ color: 'var(--muted)' }} aria-hidden="true">
      <MapPin size={18} />
    </span>
  )

  if (variant === 'home') {
    return (
      <header className={`topbar ${floating ? 'floating' : ''}`}>
        <div className="row" style={{ gap: 8 }}>
          {pin}
          {label}
        </div>
        {trip && (
          <span className="badge badge-live">
            יום <span className="num">{trip.day}</span>/<span className="num">{trip.totalDays}</span>
          </span>
        )}
      </header>
    )
  }

  if (variant === 'brand') {
    return (
      <header className={`topbar ${floating ? 'floating' : ''}`}>
        <div className="row" style={{ gap: 8 }}>
          {bell}
          {pin}
          {label}
        </div>
        <span className="brand">TripAI</span>
      </header>
    )
  }

  return (
    <header className={`topbar ${floating ? 'floating' : ''}`}>
      {pin}
      {label}
      {bell}
    </header>
  )
}
