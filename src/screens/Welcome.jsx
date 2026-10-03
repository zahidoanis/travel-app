import { Sparkles, MapPin, Users, Route, ArrowLeft } from '../components/Icons'
import { hasFirebase } from '../lib/firebase'
import { t } from '../i18n'
import LangToggle from '../components/LangToggle'

// The four things this app does that a list of links doesn't — the agent,
// the plan on a map, bringing an existing Google Maps plan in, and one
// shared trip for everyone.
const FEATURES = [
  { Icon: Sparkles, title: t('סוכן AI שמתכנן איתכם'), sub: t("שואלים בצ'אט, מקבלים המלצות — וכל מקום נכנס למסלול בלחיצה. הוא גם זוכר מה אתם אוהבים.") },
  { Icon: MapPin, title: t('מסלול יומי על המפה'), sub: t('כל יום עם שעות, מקומות אמיתיים, מזג אוויר וניווט') },
  { Icon: Route, title: t('כבר תכננתם ב-Google Maps?'), sub: t('מדביקים קישור, והמסלול נכנס מחולק לימים') },
  { Icon: Users, title: t('טיול משותף'), sub: t('קישור אחד בוואטסאפ — וכולם רואים את אותו מסלול, מתעדכן בזמן אמת') },
]

export default function Welcome({ onStart, onSignIn }) {
  return (
    <div className="welcome">
      {/* Decorative only — the content below carries the meaning. */}
      <div className="welcome-aura" aria-hidden="true" />
      <div className="welcome-grid" aria-hidden="true" />
      <LangToggle className="welcome-lang" />

      <div className="welcome-inner">
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
          {t('חינם לחלוטין · ללא הרשמה · ארבע שאלות קצרות')}
        </p>
        {/* Not a wall — planning first without an account still works exactly
            as before. This is for someone who already has trips on a Google
            account and would rather see those than plan a new one. */}
        {hasFirebase && (
          <button className="welcome-signin" onClick={onSignIn}>
            {t('כבר יש לך טיול? התחבר עם Google')}
          </button>
        )}
      </div>
    </div>
  )
}
