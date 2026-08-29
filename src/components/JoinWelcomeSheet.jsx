import Sheet from './Sheet'
import { Route, Wallet, Users, Check } from './Icons'
import { useTrip } from '../TripProvider'

/**
 * Shown once, right after joining someone else's trip by link or by code.
 * Landing silently inside a shared plan with no explanation of what you can
 * actually do with it was the gap — this is the one-time orientation.
 *
 * The route description below has to hold both shapes at once: a solo
 * family's trip really is one shared plan, but once a second family
 * exists, each one plans independently and this same joiner can freely
 * switch between and edit *any* of them — there's no per-family login,
 * "who you are" here is just whichever plan you have open.
 */
export default function JoinWelcomeSheet() {
  const { justJoined, dismissJustJoined, trip, families } = useTrip()

  if (!trip) return null

  return (
    <Sheet open={justJoined} title={`הצטרפת לטיול ל${trip.city}!`} onClose={dismissJustJoined}>
      <p className="sub" style={{ marginBottom: 18 }}>
        {families.length > 1
          ? 'כל משפחה מתכננת את הימים שלה בנפרד — אפשר לעבור בין המשפחות ולערוך את כולן, ולסמן ימים שנמצאים ביחד כ"יחד" כדי לתכנן אותם על אותו לו"ז משותף.'
          : 'זה מסלול אחד משותף — לא עותק אישי. כל שינוי שמישהו עושה מופיע אצל כולם באותו רגע.'}
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
            הוצאות ורשימת הערות משותפות לכל הטיול, לא לפי משפחה.
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
