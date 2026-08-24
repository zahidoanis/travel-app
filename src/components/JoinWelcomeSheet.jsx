import Sheet from './Sheet'
import { Route, Wallet, Users, Check } from './Icons'
import { useTrip } from '../TripProvider'

/**
 * Shown once, right after joining someone else's trip by link or by code.
 * Landing silently inside a shared plan with no explanation of what you can
 * actually do with it was the gap — this is the one-time orientation.
 */
export default function JoinWelcomeSheet() {
  const { justJoined, dismissJustJoined, trip } = useTrip()

  if (!trip) return null

  return (
    <Sheet open={justJoined} title={`הצטרפת לטיול ל${trip.city}!`} onClose={dismissJustJoined}>
      <p className="sub" style={{ marginBottom: 18 }}>
        זה מסלול אחד משותף — לא עותק אישי. כל שינוי שמישהו עושה מופיע אצל
        כולם באותו רגע.
      </p>

      <div className="col" style={{ gap: 12, marginBottom: 22 }}>
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span className="contact-icon"><Route size={15} /></span>
          <span className="tiny" style={{ lineHeight: 1.6 }}>
            אפשר לערוך את הלו"ז — להוסיף עצירות, לשנות סדר — בדיוק כמו כל
            חבר אחר בטיול.
          </span>
        </div>
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span className="contact-icon"><Wallet size={15} /></span>
          <span className="tiny" style={{ lineHeight: 1.6 }}>
            הוצאות מתחלקות אוטומטית בין כל המשתתפים או לפי משפחה.
          </span>
        </div>
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span className="contact-icon"><Users size={15} /></span>
          <span className="tiny" style={{ lineHeight: 1.6 }}>
            מי כבר הצטרף אפשר לראות בכפתור השיתוף במסך הבית.
          </span>
        </div>
      </div>

      <button className="btn btn-primary btn-block" onClick={dismissJustJoined}>
        <Check size={17} />
        הבנתי, בואו נתחיל
      </button>
    </Sheet>
  )
}
