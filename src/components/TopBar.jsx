import { Bell, MapPin, User } from './Icons'
import { useTrip } from '../TripProvider'
import { initials } from '../lib/text'
import { t } from '../i18n'
import LangToggle from './LangToggle'

/**
 * One top bar, the same on every screen: where the trip is on the start
 * edge; language, notifications and the account on the end edge.
 *
 * There used to be three variants — Home swapped the bell for a "save the
 * trip" pill, Finance added a second TripAI wordmark — so the same buttons
 * moved around from screen to screen. An unsaved trip is now a dot on the
 * account button (which is where saving happens), plus one card on Home.
 *
 * `variant` is accepted and ignored, so older call sites keep working.
 */
// eslint-disable-next-line no-unused-vars
export default function TopBar({ variant, floating = false }) {
  const { trip, syncState, user, openAccount, openNotifications, unreadCount } = useTrip()

  const signedIn = user && !user.anonymous
  const initialsText = signedIn ? initials(user.name) : ''
  const unsaved = syncState === 'device'

  return (
    <header className={`topbar ${floating ? 'floating' : ''}`}>
      <div className="row topbar-place" style={{ gap: 7, minWidth: 0 }}>
        <span style={{ color: 'var(--muted)', flex: 'none' }} aria-hidden="true">
          <MapPin size={18} />
        </span>
        <span className="topbar-title">
          {trip ? trip.city : 'TripAI'}
          {trip?.country ? <span className="tiny"> · {trip.country}</span> : null}
        </span>
      </div>

      <div className="row" style={{ gap: 4, flex: 'none' }}>
        <LangToggle compact />
        <button className="icon-btn bell" onClick={openNotifications} aria-label={t('התראות')}>
          <Bell size={19} />
          {unreadCount > 0 ? <span className="bell-dot" aria-hidden="true" /> : null}
        </button>
        <button
          className="icon-btn account-btn"
          onClick={openAccount}
          aria-label={signedIn ? t('החשבון שלך') : unsaved ? t('שמור את הטיול') : t('שמור טיול או התחל טיול נוסף')}
          title={unsaved ? t('הטיול שמור רק בדפדפן הזה — לחצו כדי לשמור אותו') : undefined}
        >
          {signedIn && user.photo ? (
            <img src={user.photo} alt="" className="topbar-photo" />
          ) : signedIn && initialsText ? (
            <span className="topbar-initials">{initialsText}</span>
          ) : (
            <User size={18} />
          )}
          {unsaved && <span className="unsaved-dot" aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}
