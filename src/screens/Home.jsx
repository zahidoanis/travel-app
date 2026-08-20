import TopBar from '../components/TopBar'
import { ArrowLeft, Sparkles, Bookmark, Clock } from '../components/Icons'
import { STOPS, RECOMMENDATIONS, TRIP } from '../data'

/** Thumbnails stand in for photography — swap the gradients for real <img>. */
const THUMB = {
  1: 'linear-gradient(150deg, #4A2C12, #1A1208 70%), radial-gradient(circle at 30% 40%, #C77B2E, transparent 60%)',
  2: 'linear-gradient(150deg, #16283F, #0A1220 70%), radial-gradient(circle at 65% 35%, #3B7FC4, transparent 60%)',
  3: 'linear-gradient(150deg, #1D3320, #0C1610 70%), radial-gradient(circle at 40% 50%, #4F9E5C, transparent 60%)',
  4: 'linear-gradient(150deg, #3A2450, #140F22 70%), radial-gradient(circle at 55% 45%, #A855F7, transparent 60%)',
}

export default function Home({ onStartRoute, onOpenChat }) {
  // The "next" stop is the first one still ahead of us in the day.
  const nextId = STOPS[1].id

  return (
    <div className="screen">
      <TopBar variant="home" />

      <div className="pad">
        <section className="hero">
          <div className="hero-icon" aria-hidden="true">☀️</div>
          <h1 className="hero-title">בוקר טוב!</h1>
          <p className="sub" style={{ maxWidth: '92%' }}>
            הנה התכנון המושלם עבור היום בבוקר ב{TRIP.city}. שילבנו אמנות, קפה משובח ומזג אוויר מושלם.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onStartRoute}>
            התחל מסלול
          </button>
        </section>
      </div>

      <div className="pad section-head">
        <h2 className="h2">התכנון להיום</h2>
        <span className="tiny">
          יום <span className="num">{TRIP.day}</span> מתוך <span className="num">{TRIP.totalDays}</span>
        </span>
      </div>

      <div className="hscroll">
        {STOPS.map((s) => {
          const isNext = s.id === nextId
          return (
            <button key={s.id} className={`timeline-card ${isNext ? 'next' : ''}`} onClick={onStartRoute}>
              <div className="between">
                <span className={`time-chip ${isNext ? 'next' : ''}`}>
                  {isNext && <i className="dot dot-pulse" style={{ display: 'inline-block', marginInlineEnd: 5 }} />}
                  <span className="num">{s.time}</span>
                  {isNext && ' (הבא)'}
                </span>
                <span style={{ color: 'var(--muted-2)' }}><Bookmark size={15} /></span>
              </div>

              <div className="thumb" style={{ background: THUMB[s.id] }}>
                <span className="thumb-title">{s.name}</span>
              </div>

              <p className="tiny" style={{ margin: 0 }}>{s.desc}</p>
            </button>
          )
        })}
      </div>

      <div className="pad section-head">
        <h2 className="h2">המלצות להמשך היום</h2>
        <button className="fab-spark" onClick={onOpenChat} aria-label="שאל את סוכן ה-AI">
          <Sparkles size={20} />
        </button>
      </div>

      <div className="hscroll">
        {RECOMMENDATIONS.map((r) => (
          <button key={r.id} className="rec-card" onClick={onOpenChat}>
            <span
              className="rec-thumb"
              style={{ background: `linear-gradient(145deg, ${r.tint}33, ${r.tint}11)` }}
              aria-hidden="true"
            >
              {r.emoji}
            </span>
            <span className="grow col" style={{ gap: 3 }}>
              <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{r.title}</strong>
              <span className="tiny">{r.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="pad" style={{ marginTop: 20 }}>
        <button className="card between" style={{ width: '100%' }} onClick={onStartRoute}>
          <span className="row">
            <span style={{ color: 'var(--lav)' }}><Clock size={18} /></span>
            <span className="col" style={{ gap: 2, textAlign: 'start' }}>
              <strong style={{ fontSize: 14, fontWeight: 600 }}>הלו"ז המלא של היום</strong>
              <span className="tiny"><span className="num">{STOPS.length}</span> עצירות · מסתיים ב-<span className="num">20:15</span></span>
            </span>
          </span>
          <ArrowLeft size={18} />
        </button>
      </div>
    </div>
  )
}
