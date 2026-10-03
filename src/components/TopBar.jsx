import { Bell, MapPin, Check, Cloud, User } from './Icons'
import { useTrip } from '../TripProvider'
import { initials } from '../lib/text'
import { t } from '../i18n'
import LangToggle from './LangToggle'

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
  const { trip, syncState, user, openAccount, openNotifications, unreadCount, canEdit } = useTrip()

  // Said once, at the top of every screen, rather than discovered by trying
  // to change something.
  const viewOnly = !canEdit && (
    <span className="badge badge-live view-only" title={t('אפשר לראות את הטיול, לא לשנות אותו')}>
      {t('צפייה בלבד')}
    </span>
  )

  const label = (
    <span className="topbar-title">
      {trip ? trip.city : 'TripAI'}
      {trip?.country ? <span className="tiny"> · {trip.country}</span> : null}
    </span>
  )

  const bell = (
    <button className="icon-btn bell" onClick={openNotifications} aria-label={t('התראות')}>
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
  const initialsText = signedIn ? initials(user.name) : ''
  const account = (
    <button
      className="icon-btn account-btn"
      onClick={openAccount}
      aria-label={signedIn ? t('החשבון שלך') : t('שמור טיול או התחל טיול נוסף')}
    >
      {signedIn && user.photo ? (
        <img src={user.photo} alt="" className="topbar-photo" />
      ) : signedIn && initialsText ? (
        <span className="topbar-initials">{initialsText}</span>
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
          {viewOnly || <SyncBadge state={syncState} day={trip} onSave={openAccount} />}
          <LangToggle compact />
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
          {viewOnly}
          <LangToggle compact />
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
        {viewOnly}
        <LangToggle compact />
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
      <span className="badge badge-live" title={t('שומר שינויים')}>
        <span className="typing"><i /><i /><i /></span>
        {t('שומר')}
      </span>
    )
  }

  if (state === 'synced') {
    return (
      <span className="badge badge-live" style={{ color: 'var(--emerald)' }} title={t('נשמר בענן')}>
        <Check size={11} />
        {day ? <>{t('יום')} <span className="num">{day.day}</span>/<span className="num">{day.totalDays}</span></> : t('מסונכרן')}
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
      title={t('הטיול קיים על מכשיר זה בלבד — לחץ כדי לשמור אותו')}
      onClick={onSave}
    >
      <Cloud size={12} />
      {t('שמור את הטיול')}
    </button>
  )
}
