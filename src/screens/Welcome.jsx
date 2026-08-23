import { Sparkles, MapPin, Users, Wallet, ArrowLeft } from '../components/Icons'

const FEATURES = [
  { Icon: Sparkles, title: 'מסלול שנבנה בשבילך', sub: 'סוכן AI מתכנן כל יום לפי הסגנון והתקציב שלך' },
  { Icon: MapPin, title: 'מפה חיה', sub: 'כל עצירה עם מיקום אמיתי, ניווט וזמני הגעה' },
  { Icon: Users, title: 'טיול משותף', sub: 'שתפו בוואטסאפ, ופצלו מסלול והוצאות לפי משפחה' },
  { Icon: Wallet, title: 'הכל מתחשבן', sub: 'המרת מטבע וחלוקת הוצאות בין כולם' },
]

export default function Welcome({ onStart }) {
  return (
    <div className="welcome">
      {/* Decorative only — the content below carries the meaning. */}
      <div className="welcome-aura" aria-hidden="true" />
      <div className="welcome-grid" aria-hidden="true" />

      <div className="welcome-inner">
        <div className="welcome-mark" aria-hidden="true">
          <Sparkles size={26} />
        </div>

        <h1 className="wordmark">
          Trip<span className="wordmark-ai">AI</span>
        </h1>

        <span className="wordmark-rule" aria-hidden="true" />

        <p className="welcome-tagline">
          תכנון טיולים חכם, בעברית
        </p>

        <p className="welcome-lede">
          ספר לנו לאן, מתי ועם מי — והסוכן יבנה מסלול יומי מלא,
          ימקם אותו על המפה, וידאג שכולם מסונכרנים לאורך כל הדרך.
        </p>

        <ul className="welcome-features">
          {FEATURES.map(({ Icon, title, sub }) => (
            <li key={title}>
              <span className="welcome-feature-icon"><Icon size={17} /></span>
              <span>
                <strong>{title}</strong>
                <span className="tiny">{sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="welcome-cta">
        <button className="btn btn-primary btn-block btn-lg" onClick={onStart}>
          בוא נתחיל
          <ArrowLeft size={19} />
        </button>
        <p className="tiny welcome-note">
          חינם לחלוטין · ללא הרשמה · שש שאלות קצרות
        </p>
      </div>
    </div>
  )
}
