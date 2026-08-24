import { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import ShareSheet from '../components/ShareSheet'
import {
  ArrowLeft, Sparkles, Bookmark, Clock, Share, Users, RefreshCw, Route, Utensils, Cloud, Plane, Note,
} from '../components/Icons'
import { headCount } from '../data'
import { useTrip } from '../TripProvider'
import PlacePhoto from '../components/PlacePhoto'
import { heroPhoto as fetchHeroPhoto } from '../lib/photos'
import { fetchForecast, GREETING } from '../lib/weather'
import { geocode } from '../lib/geocode'
import { CITIES } from '../cities'
import WeatherSheet from '../components/WeatherSheet'
import NoteSheet from '../components/NoteSheet'

/** Color wash over the hero photo, matched to the same period the
 *  temperature line already reports — golden hour reads golden. */
const TOD_TINT = {
  morning: 'rgba(255,196,120,0.30)',
  noon: 'rgba(255,255,255,0.10)',
  evening: 'rgba(255,110,80,0.34)',
  night: 'rgba(30,20,70,0.46)',
}


export default function Home({ onStartRoute, onOpenChat, onOpenDays, onOpenFood, onOpenArrival }) {
  // "all" shows the shared itinerary; picking a party narrows it to the stops
  // that party is actually attending.
  const {
    trip: TRIP, stops: STOPS, families: FAMILIES, planning, planWarning, plan, syncState,
    openAccount, openEdit, addNote, updateNote, removeNote,
  } = useTrip()
  const [party, setParty] = useState('all')
  const [shareOpen, setShareOpen] = useState(false)
  const [forecast, setForecast] = useState(null)
  const [forecastOpen, setForecastOpen] = useState(false)
  const [noteEditing, setNoteEditing] = useState(null)
  const [heroPhoto, setHeroPhoto] = useState(null)
  const [heroPhotoLoaded, setHeroPhotoLoaded] = useState(false)

  // A real photo of the destination behind the greeting, the way every
  // travel app with a design budget does it — falls back to the plain
  // gradient card silently when Wikipedia has nothing for this city rather
  // than blocking on it or showing a broken-image state.
  useEffect(() => {
    if (!TRIP) return
    let cancelled = false
    setHeroPhoto(null)
    setHeroPhotoLoaded(false)
    fetchHeroPhoto(TRIP.cityEn ?? TRIP.city).then((hit) => {
      if (!cancelled) setHeroPhoto(hit)
    })
    return () => { cancelled = true }
  }, [TRIP?.id, TRIP?.cityEn, TRIP?.city])

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
        // The curated list first — geocoding the Hebrew city name directly
        // is not reliable (verified: "פראג" alone returned a bus stop in Or
        // Akiva, not Prague, with nothing about the result to say it was
        // wrong). cityEn falls back to the Hebrew name when no English form
        // was ever stored, which is exactly the trips that need this lookup.
        const known = CITIES.find((c) => c.he === TRIP.city || c.en === TRIP.cityEn)
        if (known) {
          lat = known.lat
          lng = known.lng
        } else {
          const hit = await geocode(TRIP.cityEn ?? TRIP.city, TRIP.country)
          lat = hit?.lat ?? null
          lng = hit?.lng ?? null
        }
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
        <section className={`hero ${heroPhoto ? 'has-photo' : ''}`}>
          {heroPhoto && (
            <>
              <img
                src={heroPhoto.url}
                alt=""
                aria-hidden="true"
                className={`hero-photo ${heroPhotoLoaded ? 'on' : ''}`}
                onLoad={() => setHeroPhotoLoaded(true)}
              />
              {/* Warm at golden hour, cool and dim at night — the same
                  reading the temperature line already gives, painted onto
                  the one card everyone sees first instead of left as a
                  number to notice or skip. */}
              <div className="hero-scrim" style={{ '--tod-tint': TOD_TINT[forecast?.now.period ?? 'noon'] }} />
            </>
          )}

          {/* Its own layer, not part of the bottom-anchored text block below —
              with a photo the card grows tall enough that grouping these
              with the title would strand them together at the bottom with
              an awkward gap of empty photo above. */}
          <div className="hero-top-row between" style={{ alignItems: 'flex-start' }}>
            <div className="hero-icon" aria-hidden="true">{forecast?.now.icon ?? '☀️'}</div>
            <button
              className="icon-btn boxed"
              onClick={() => setShareOpen(true)}
              aria-label="שתף את המסלול"
            >
              <Share size={17} />
            </button>
          </div>

          <div className="hero-content">
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
          </div>
        </section>
      </div>

      {/* General trip notes — a driver's name, a booking code, anything
          that isn't tied to one stop on the map and so has no other home.
          Kept visible here rather than a tap away, since this is exactly
          the screen someone lands on when they need the reminder. */}
      <div className="pad" style={{ marginTop: 20 }}>
        <div className="section-head" style={{ marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--lav)' }}><Note size={17} /></span>
            <h2 className="h2" style={{ fontSize: 16 }}>הערות</h2>
          </div>
          <button
            onClick={() => setNoteEditing({ isNew: true })}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
          >
            הוסף +
          </button>
        </div>

        {TRIP.notes.length > 0 ? (
          <div className="card" style={{ paddingBlock: 4 }}>
            {TRIP.notes.map((n) => (
              <button
                key={n.id}
                className="expense-row"
                style={{ width: '100%', textAlign: 'start' }}
                onClick={() => setNoteEditing({ isNew: false, id: n.id, text: n.text })}
                aria-label="ערוך הערה"
              >
                <span className="tiny" style={{ lineHeight: 1.6 }}>{n.text}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="tiny">אין עדיין הערות. לדוגמה: פרטי נהג, קוד לדירה, מספר הזמנה.</p>
        )}
      </div>

      {/* Split the day by travel party */}
      <div className="pad section-head" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--lav)' }}><Users size={17} /></span>
          <h2 className="h2" style={{ fontSize: 16 }}>מי מטייל</h2>
        </div>
        <span className="row" style={{ gap: 14 }}>
          <button
            onClick={() => openEdit('who')}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}
          >
            ערוך
          </button>
          <button
            onClick={() => setShareOpen(true)}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
          >
            הזמן חברים +
          </button>
        </span>
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
      <NoteSheet
        open={noteEditing !== null}
        isNew={noteEditing?.isNew ?? true}
        initialText={noteEditing?.text}
        onClose={() => setNoteEditing(null)}
        onSave={async (text) => {
          if (noteEditing?.isNew) await addNote(text)
          else await updateNote(noteEditing.id, text)
          setNoteEditing(null)
        }}
        onDelete={async () => {
          await removeNote(noteEditing.id)
          setNoteEditing(null)
        }}
      />
    </div>
  )
}
