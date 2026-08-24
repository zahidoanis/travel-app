import { Bell, MapPin, Check, Cloud, User } from './Icons'
import { useTrip } from '../TripProvider'

/**
 * Three variants, matching the screens:
 *   "home"     — destination on the start edge, sync badge on the end edge
 *   "centered" — bell / destination / spacer   (map, gallery, chat)
 *   "brand"    — TripAI wordmark on the end edge (finance)
 *
 * The account button rides in every variant, because it is the only door to
 * the account sheet — switching trips, starting another one, signing in —
 * and this is the one element every screen renders. It used to live only on
 * Home, and only before signing in: once syncState left "device" the button
 * that opened it disappeared with the card it was attached to, so a signed-in
 * phone had no way back into the sheet at all.
 *
 * The weather readout that used to sit here was invented — no provider is
 * wired up — so it is gone rather than showing a number nobody measured.
 */
export default function TopBar({ variant = 'centered', floating = false }) {
  const { trip, syncState, user, openAccount, openNotifications, unreadCount } = useTrip()

  const label = (
    <span className="topbar-title">
      {trip ? trip.city : 'TripAI'}
      {trip?.country ? <span className="tiny"> · {trip.country}</span> : null}
    </span>
  )

  const bell = (
    <button className="icon-btn bell" onClick={openNotifications} aria-label="התראות">
      <Bell size={19} />
      {unreadCount > 0 ? <span className="bell-dot" aria-hidden="true" /> : null}
    </button>
  )

  const pin = (
    <span style={{ color: 'var(--muted)' }} aria-hidden="true">
      <MapPin size={18} />
    </span>
  )

  const signedIn = user && !user.anonymous
  const account = (
    <button
      className="icon-btn account-btn"
      onClick={openAccount}
      aria-label={signedIn ? 'החשבון שלך' : 'שמור טיול או התחל טיול נוסף'}
    >
      {signedIn && user.photo ? (
        <img src={user.photo} alt="" className="topbar-photo" />
      ) : (
        <User size={18} />
      )}
    </button>
  )

  if (variant === 'home') {
    return (
      <header className={`topbar ${floating ? 'floating' : ''}`}>
        <div className="row" style={{ gap: 8 }}>
          {pin}
          {label}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <SyncBadge state={syncState} day={trip} onSave={openAccount} />
          {account}
        </div>
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
        <div className="row" style={{ gap: 10 }}>
          {account}
          <span className="brand">TripAI</span>
        </div>
      </header>
    )
  }

  return (
    <header className={`topbar ${floating ? 'floating' : ''}`}>
      {pin}
      {label}
      <div className="row" style={{ gap: 8 }}>
        {bell}
        {account}
      </div>
    </header>
  )
}

/**
 * Says whether the user's work is safe. The badge that used to live here was
 * decorative — it read "מסונכרן" whether anything was synced or not.
 *
 * The unsaved state used to just name the fact ("מכשיר זה בלבד") and stop —
 * true, but not actionable, and the exact condition that turned into real
 * data loss this session (an anonymous session wiped by clearing browsing
 * data, with the trip unreachable afterward). Now it's a button that says
 * what to do about it and opens straight to the fix, rather than a label
 * someone has to already know to worry about.
 */
function SyncBadge({ state, day, onSave }) {
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

  // Not signed in, or no backend at all: the work lives on this device only
  // and could be gone the moment browsing data is cleared. Say what to do
  // about it, not just that it's true.
  return (
    <button
      className="badge badge-live"
      style={{ color: 'var(--amber)' }}
      title="הטיול קיים על מכשיר זה בלבד — לחץ כדי לשמור אותו"
      onClick={onSave}
    >
      <Cloud size={12} />
      שמור את הטיול
    </button>
  )
}
