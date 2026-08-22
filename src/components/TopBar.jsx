import { Bell, MapPin, Check, Cloud } from './Icons'
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
  const { trip, syncState } = useTrip()

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
        <SyncBadge state={syncState} day={trip} />
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

/**
 * Says whether the user's work is safe. The badge that used to live here was
 * decorative — it read "מסונכרן" whether anything was synced or not.
 */
function SyncBadge({ state, day }) {
  if (state === 'saving') {
    return (
      <span className="badge badge-live" title="שומר שינויים">
        <span className="typing"><i /><i /><i /></span>
        שומר
      </span>
    )
  }

  if (state === 'synced') {
    return (
      <span className="badge badge-live" style={{ color: 'var(--emerald)' }} title="נשמר בענן">
        <Check size={11} />
        {day ? <>יום <span className="num">{day.day}</span>/<span className="num">{day.totalDays}</span></> : 'מסונכרן'}
      </span>
    )
  }

  // Not signed in, or no backend at all: the work lives on this device only,
  // and that is worth saying out loud rather than implying otherwise.
  return (
    <span className="badge badge-live" style={{ color: 'var(--amber)' }} title="הטיול קיים על מכשיר זה בלבד">
      <Cloud size={12} />
      מכשיר זה בלבד
    </span>
  )
}
