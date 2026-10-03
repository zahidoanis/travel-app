import { Sparkles, MapPin, Users, Wallet, ArrowLeft } from '../components/Icons'
import { hasFirebase } from '../lib/firebase'
import { t } from '../i18n'
import LangToggle from '../components/LangToggle'
import ConsentNote from '../components/ConsentNote'
import LegalLinks from '../components/LegalLinks'

const FEATURES = [
  { Icon: Sparkles, title: t('מסלול שנבנה בשבילך'), sub: t('סוכן AI מתכנן כל יום לפי הסגנון והתקציב שלך') },
  { Icon: MapPin, title: t('מפה חיה'), sub: t('כל עצירה עם מיקום אמיתי, ניווט וזמני הגעה') },
  { Icon: Users, title: t('טיול משותף'), sub: t('שתפו בוואטסאפ — מסלול אחד לכולם, ועדכון מופיע אצל כולם מיד') },
  { Icon: Wallet, title: t('הכל מתחשבן'), sub: t('המרת מטבע וחלוקת הוצאות בין כולם') },
]

export default function Welcome({ onStart, onSignIn }) {
  return (
    <div className="welcome">
      {/* Decorative only — the content below carries the meaning. */}
      <div className="welcome-aura" aria-hidden="true" />
      <div className="welcome-grid" aria-hidden="true" />
      <LangToggle className="welcome-lang" />

      {/* Focusable because it scrolls: on a short screen the feature list
          runs past the fold, and a keyboard has no other way to reach it. */}
      <div className="welcome-inner" tabIndex={0}>
        <div className="welcome-mark" aria-hidden="true">
          <Sparkles size={26} />
        </div>

        <h1 className="wordmark">
          Trip<span className="wordmark-ai">AI</span>
        </h1>

        <span className="wordmark-rule" aria-hidden="true" />

        <p className="welcome-tagline">
          {t('תכנון טיולים חכם, בעברית')}
        </p>

        <p className="welcome-lede">
          {t('ספר לנו לאן, מתי ועם מי — והסוכן יבנה מסלול יומי מלא, ימקם אותו על המפה, וידאג שכולם מסונכרנים לאורך כל הדרך.')}
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
          {t('בוא נתחיל')}
          <ArrowLeft size={19} />
        </button>
        <p className="tiny welcome-note">
          {t('חינם לחלוטין · ללא הרשמה · כמה שאלות קצרות')}
        </p>
        {/* Not a wall — planning first without an account still works exactly
            as before. This is for someone who already has trips on a Google
            account and would rather see those than plan a new one. */}
        {hasFirebase && (
          <button className="welcome-signin" onClick={onSignIn}>
            {t('כבר יש לך טיול? התחבר עם Google')}
          </button>
        )}
        <ConsentNote className="welcome-consent" />
        <LegalLinks className="welcome-legal" />
      </div>
    </div>
  )
}
