import { useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import ShareSheet from '../components/ShareSheet'
import { ArrowLeft, Sparkles, Bookmark, Clock, Share, Users, RefreshCw } from '../components/Icons'
import { RECOMMENDATIONS, headCount } from '../data'
import { useTrip } from '../TripProvider'

/** Thumbnails stand in for photography — swap the gradients for real <img>. */
const THUMB = {
  1: 'linear-gradient(150deg, #4A2C12, #1A1208 70%), radial-gradient(circle at 30% 40%, #C77B2E, transparent 60%)',
  2: 'linear-gradient(150deg, #16283F, #0A1220 70%), radial-gradient(circle at 65% 35%, #3B7FC4, transparent 60%)',
  3: 'linear-gradient(150deg, #1D3320, #0C1610 70%), radial-gradient(circle at 40% 50%, #4F9E5C, transparent 60%)',
  4: 'linear-gradient(150deg, #3A2450, #140F22 70%), radial-gradient(circle at 55% 45%, #A855F7, transparent 60%)',
}

export default function Home({ onStartRoute, onOpenChat }) {
  // "all" shows the shared itinerary; picking a party narrows it to the stops
  // that party is actually attending.
  const { trip: TRIP, stops: STOPS, families: FAMILIES, planning, planWarning, plan } = useTrip()
  const [party, setParty] = useState('all')
  const [shareOpen, setShareOpen] = useState(false)

  const stops = useMemo(
    () => (party === 'all' ? STOPS : STOPS.filter((s) => s.who.includes(party))),
    [party, STOPS]
  )

  // The "next" stop is the first one still ahead of us in the filtered day.
  const nextId = stops[1]?.id ?? stops[0]?.id

  return (
    <div className="screen">
      <TopBar variant="home" />

      <div className="pad">
        <section className="hero">
          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div className="hero-icon" aria-hidden="true">☀️</div>
            <button
              className="icon-btn boxed"
              onClick={() => setShareOpen(true)}
              aria-label="שתף את המסלול"
              style={{ position: 'relative', zIndex: 1 }}
            >
              <Share size={17} />
            </button>
          </div>
          <h1 className="hero-title">בוקר טוב!</h1>
          <p className="sub" style={{ maxWidth: '92%' }}>
            {planning
              ? `הסוכן בונה עכשיו מסלול ל${TRIP.city}...`
              : `הנה התכנון ליום ${TRIP.day} ב${TRIP.city}, מותאם לסגנון שבחרת.`}
          </p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onStartRoute}>
            התחל מסלול
          </button>
        </section>
      </div>

      {/* Split the day by travel party */}
      <div className="pad section-head" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--lav)' }}><Users size={17} /></span>
          <h2 className="h2" style={{ fontSize: 16 }}>מי מטייל</h2>
        </div>
        <button
          onClick={() => setShareOpen(true)}
          style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
        >
          הזמן חברים +
        </button>
      </div>

      <div className="hscroll" style={{ paddingBlock: 0 }}>
        <button className={`pill ${party === 'all' ? 'on' : ''}`} onClick={() => setParty('all')}>
          כולם (<span className="num">{headCount(FAMILIES.map((f) => f.id), FAMILIES)}</span>)
        </button>
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            className={`pill ${party === f.id ? 'on' : ''}`}
            onClick={() => setParty(f.id)}
          >
            <i className="dot" style={{ background: f.color, marginInlineEnd: 6 }} />
            {f.name}
          </button>
        ))}
      </div>

      <div className="pad section-head">
        <h2 className="h2">התכנון להיום</h2>
        <span className="row" style={{ gap: 10 }}>
          <span className="tiny">
            {party === 'all' ? (
              <>יום <span className="num">{TRIP.day}</span> מתוך <span className="num">{TRIP.totalDays}</span></>
            ) : (
              <><span className="num">{stops.length}</span> מתוך <span className="num">{STOPS.length}</span> עצירות</>
            )}
          </span>
          <button
            className="icon-btn"
            style={{ width: 30, height: 30 }}
            onClick={plan}
            disabled={planning}
            aria-label="בנה מסלול מחדש"
            title="בנה מסלול מחדש"
          >
            <RefreshCw size={15} />
          </button>
        </span>
      </div>

      {planWarning && (
        <div className="pad" style={{ marginBottom: 10 }}>
          <p className="tiny" style={{ color: 'var(--amber)' }}>{planWarning}</p>
        </div>
      )}

      <div className="hscroll">
        {stops.map((s) => {
          const isNext = s.id === nextId
          const going = FAMILIES.filter((f) => s.who.includes(f.id))
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

              <div className="thumb" style={{ background: THUMB[((s.id - 1) % 4) + 1] }}>
                <span className="thumb-title">{s.name}</span>
              </div>

              <p className="tiny" style={{ margin: '0 0 10px' }}>{s.desc}</p>

              {/* Who is attending this stop */}
              <div className="row" style={{ gap: 5 }}>
                <span className="stack">
                  {going.map((f) => (
                    <i key={f.id} className="stack-dot" style={{ background: f.color }} title={f.name} />
                  ))}
                </span>
                <span className="tiny">
                  {going.length === FAMILIES.length
                    ? 'כולם'
                    : <><span className="num">{headCount(s.who, FAMILIES)}</span> נוסעים</>}
                </span>
              </div>
            </button>
          )
        })}

        {planning && stops.length === 0 && (
          <div className="timeline-card" style={{ display: 'grid', placeItems: 'center', height: 180 }}>
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}

        {!planning && stops.length === 0 && (
          <div className="timeline-card" style={{ display: 'grid', placeItems: 'center', height: 180 }}>
            <span className="tiny">אין עצירות משותפות ליום הזה</span>
          </div>
        )}
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
              <span className="tiny"><span className="num">{stops.length}</span> עצירות · מסתיים ב-<span className="num">{STOPS[STOPS.length - 1]?.time ?? '—'}</span></span>
            </span>
          </span>
          <ArrowLeft size={18} />
        </button>
      </div>

      <ShareSheet open={shareOpen} stops={STOPS} onClose={() => setShareOpen(false)} />
    </div>
  )
}
