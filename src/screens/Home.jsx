import { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import ShareSheet from '../components/ShareSheet'
import {
  ArrowLeft, Sparkles, Bookmark, Clock, Share, Users, RefreshCw, Route, Utensils, Cloud, Plane,
} from '../components/Icons'
import { headCount } from '../data'
import { useTrip } from '../TripProvider'
import PlacePhoto from '../components/PlacePhoto'
import { fetchForecast, GREETING } from '../lib/weather'
import { geocode } from '../lib/geocode'
import WeatherSheet from '../components/WeatherSheet'


export default function Home({ onStartRoute, onOpenChat, onOpenDays, onOpenFood, onOpenArrival }) {
  // "all" shows the shared itinerary; picking a party narrows it to the stops
  // that party is actually attending.
  const {
    trip: TRIP, stops: STOPS, families: FAMILIES, planning, planWarning, plan, syncState,
    openAccount,
  } = useTrip()
  const [party, setParty] = useState('all')
  const [shareOpen, setShareOpen] = useState(false)
  const [forecast, setForecast] = useState(null)
  const [forecastOpen, setForecastOpen] = useState(false)

  // Real temperature and local time of day at the destination, not the
  // visitor's own clock — plus the rest of today and the coming week, so the
  // forecast sheet has data the instant it opens. Trips created before this
  // existed have no stored coordinates, so a trip missing them is geocoded
  // here once rather than left permanently without a reading.
  useEffect(() => {
    if (!TRIP) return
    let cancelled = false

    ;(async () => {
      let { lat, lng } = TRIP
      if (lat == null || lng == null) {
        const hit = await geocode(TRIP.city, TRIP.country)
        lat = hit?.lat ?? null
        lng = hit?.lng ?? null
      }
      const f = await fetchForecast(lat, lng)
      if (!cancelled) setForecast(f)
    })()

    return () => { cancelled = true }
  }, [TRIP?.id, TRIP?.lat, TRIP?.lng])

  const stops = useMemo(
    () => (party === 'all' ? STOPS : STOPS.filter((s) => s.who.includes(party))),
    [party, STOPS]
  )

  // After every hook: an early return above them changes the hook count
  // between renders, which React rejects outright.
  if (!TRIP) return null

  // The "next" stop is the first one still ahead of us in the filtered day.
  const nextId = stops[1]?.id ?? stops[0]?.id

  return (
    <div className="screen">
      <TopBar variant="home" />

      <div className="pad">
        <section className="hero">
          <div className="between" style={{ alignItems: 'flex-start' }}>
            <div className="hero-icon" aria-hidden="true">{forecast?.now.icon ?? '☀️'}</div>
            <button
              className="icon-btn boxed"
              onClick={() => setShareOpen(true)}
              aria-label="שתף את המסלול"
              style={{ position: 'relative', zIndex: 1 }}
            >
              <Share size={17} />
            </button>
          </div>
          {/* Neutral until the destination's real local time resolves — a
              placeholder greeting is fine, a wrong one (guessed from the
              visitor's own clock) is not. */}
          <h1 className="hero-title">
            {forecast ? `${GREETING[forecast.now.period]}!` : 'שלום!'}
          </h1>
          {forecast && (
            <button
              className="tiny row"
              style={{ gap: 5, marginTop: 2, textDecoration: 'underline', textUnderlineOffset: 3 }}
              onClick={() => setForecastOpen(true)}
            >
              <span aria-hidden="true">{forecast.now.icon}</span>
              <span className="num">{forecast.now.tempC}°</span> ב{TRIP.city} עכשיו · תחזית
            </button>
          )}
          <p className="sub" style={{ maxWidth: '92%', marginTop: forecast ? 8 : undefined }}>
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

      <div className="hscroll chips" style={{ paddingBlock: 0 }}>
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

              <PlacePhoto name={s.name} cat={s.cat} title={s.name} />

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

      {/* Not signed in: the trip lives on this device only, and that is worth
          saying where the value is visible rather than at the door. */}
      {syncState === 'device' && (
        <div className="pad" style={{ marginTop: 18 }}>
          <button className="save-prompt" onClick={openAccount}>
            <span className="save-icon"><Cloud size={17} /></span>
            <span className="grow col" style={{ gap: 3, textAlign: 'start' }}>
              <strong>שמור כדי לפתוח גם מהטלפון</strong>
              <span className="tiny">הטיול קיים כרגע על המכשיר הזה בלבד</span>
            </span>
            <ArrowLeft size={17} />
          </button>
        </div>
      )}

      {/* Recommendations come from the agent, which knows the real itinerary —
          there is no canned list to fall back on. */}
      <div className="pad" style={{ marginTop: 20 }}>
        <button className="card between" style={{ width: "100%" }} onClick={onOpenChat}>
          <span className="row">
            <span className="fab-spark" style={{ width: 34, height: 34 }}>
              <Sparkles size={17} />
            </span>
            <span className="col" style={{ gap: 2, textAlign: "start" }}>
              <strong style={{ fontSize: 14, fontWeight: 600 }}>שאל את הסוכן</strong>
              <span className="tiny">המלצות להמשך היום, לפי המסלול שלך</span>
            </span>
          </span>
          <ArrowLeft size={18} />
        </button>
      </div>

      {/* The rail carries these on desktop; on mobile this is the way in. */}
      <div className="pad" style={{ marginTop: 20 }}>
        <div className="col" style={{ gap: 10 }}>
          <button className="card between" style={{ width: '100%' }} onClick={onOpenDays}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Route size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>מסלול הטיול</strong>
                <span className="tiny">
                  <span className="num">{TRIP.totalDays}</span> ימים · הוסף עצירות ושנה סדר
                </span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onOpenFood}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Utensils size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>איפה אוכלים</strong>
                <span className="tiny">המלצות מסעדות לפי ההעדפות שלכם</span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onOpenArrival}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Plane size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>הגעה ליעד</strong>
                <span className="tiny">טיסה, שדה תעופה והדרך למלון</span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onStartRoute}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Clock size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>הלו"ז המלא של היום</strong>
                <span className="tiny">
                  <span className="num">{stops.length}</span> עצירות · מסתיים ב-
                  <span className="num">{STOPS[STOPS.length - 1]?.time ?? '—'}</span>
                </span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>

      <ShareSheet open={shareOpen} stops={STOPS} onClose={() => setShareOpen(false)} />
      <WeatherSheet
        open={forecastOpen}
        onClose={() => setForecastOpen(false)}
        forecast={forecast}
        city={TRIP.city}
      />
    </div>
  )
}
