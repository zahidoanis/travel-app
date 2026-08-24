import Sheet from './Sheet'
import { Route, Note, Users, Bell } from './Icons'
import { useTrip } from '../TripProvider'

const ICON = { stop: Route, note: Note, join: Users }

/** "לפני 5 דקות" — coarse on purpose, this is a glance-and-close feed, not
 *  a log that needs to-the-second precision. */
function timeAgo(createdAt) {
  const ms = (createdAt?.seconds ?? 0) * 1000
  if (!ms) return ''
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (mins < 1) return 'הרגע'
  if (mins < 60) return `לפני ${mins} דק׳`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  return `לפני ${Math.round(hours / 24)} ימים`
}

/**
 * What the bell opens. A feed of what changed on the shared trip — stops
 * added or removed, notes, who joined — not a general-purpose notification
 * system. There is no push here: this only shows what happened while the
 * app was open enough to catch it, which is the honest scope of what a
 * free, no-backend-functions stack can promise.
 */
export default function NotificationsSheet() {
  const { activity, notificationsOpen, closeNotifications } = useTrip()

  return (
    <Sheet open={notificationsOpen} title="מה קרה בטיול" onClose={closeNotifications}>
      {activity.length === 0 ? (
        <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
          <span style={{ color: 'var(--muted)' }}><Bell size={15} /></span>
          <p className="tiny" style={{ margin: 0 }}>
            כאן יופיעו עדכונים מהטיול — עצירות שנוספו, הערות, ומי הצטרף.
          </p>
        </div>
      ) : (
        <div className="col" style={{ gap: 2 }}>
          {activity.map((a) => {
            const Icon = ICON[a.type] ?? Bell
            return (
              <div key={a.id} className="row" style={{ gap: 11, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="contact-icon"><Icon size={14} /></span>
                <span className="grow col" style={{ gap: 1 }}>
                  <span style={{ fontSize: 13.5 }}>{a.message}</span>
                  <span className="tiny">{timeAgo(a.createdAt)}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </Sheet>
  )
}
