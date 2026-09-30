import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import ShareSheet from '../components/ShareSheet'
import {
  ArrowLeft, Sparkles, Bookmark, Clock, Share, Users, RefreshCw, Route, Utensils, Cloud, Plane, Note, Layers, Bed, Printer,
} from '../components/Icons'
import { useTrip } from '../TripProvider'
import PlacePhoto from '../components/PlacePhoto'
import { heroPhoto as fetchHeroPhoto } from '../lib/photos'
import { fetchForecast, fetchClimateAverage, GREETING } from '../lib/weather'
import { geocode } from '../lib/geocode'
import { CITIES } from '../cities'
import WeatherSheet from '../components/WeatherSheet'
import NoteSheet from '../components/NoteSheet'
import { record } from '../lib/telemetry'
import { t, tn, lang } from '../i18n'

/** "מגיעים ב-25.8 בשעה 14:30 · עוזבים ב-28.8" — the tooltip on a family's
 *  pill, built from whichever of arriveAt/departAt were actually set. */
function arrivalTitle(f) {
  const part = (label, dt) => {
    if (!dt) return null
    const [datePart, time] = dt.split('T')
    const [, m, d] = datePart.split('-').map(Number)
    const date = lang === 'en' ? `${m}/${d}` : `${d}.${m}`
    return t('{label} ב-{date}', { label, date }) + (time ? t(' בשעה {time}', { time }) : '')
  }
  return [part(t('מגיעים'), f.arriveAt), part(t('עוזבים'), f.departAt)].filter(Boolean).join(' · ') || undefined
}

/** Calendar days from today to a "YYYY-MM-DD" date — built from local parts
 *  rather than a UTC-midnight Date diff, same reasoning as every other date
 *  math in this app: a viewer west of Greenwich would otherwise see the
 *  count off by a day near midnight. */
function daysUntil(dateStr) {
  if (!dateStr) return 0
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target - today) / 86400000)
}

/** Color wash over the hero photo, matched to the same period the
 *  temperature line already reports — golden hour reads golden. */
const TOD_TINT = {
  morning: 'rgba(255,196,120,0.30)',
  noon: 'rgba(255,255,255,0.10)',
  evening: 'rgba(255,110,80,0.34)',
  night: 'rgba(30,20,70,0.46)',
}


export default function Home({ onStartRoute, onOpenChat, onOpenDays, onOpenFood, onOpenArrival, onOpenHotels, onOpenSummary }) {
  const {
    trip: TRIP, stops: STOPS, families: FAMILIES, activeFamily, switchFamily,
    planning, planWarning, plan, syncState, trips,
    openAccount, openEdit, addNote, updateNote, removeNote,
  } = useTrip()
  const [shareOpen, setShareOpen] = useState(false)
  const [forecast, setForecast] = useState(null)
  const [climate, setClimate] = useState(null)
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
    // English country disambiguates the photo search ("Rome" alone finds
    // Rome, Georgia) — known for any city picked from the curated list.
    const countryEn = CITIES.find((c) => c.en === TRIP.cityEn || c.he === TRIP.city)?.countryEn ?? ''
    fetchHeroPhoto(TRIP.cityEn ?? TRIP.city, 1200, countryEn).then((hit) => {
      if (cancelled || !hit) return
      setHeroPhoto(hit)
      // Preloaded off-DOM, purely to know when it's safe to fade the CSS
      // background-image in — this used to be a rendered <img>'s own onLoad,
      // but a real <img> sitting over tappable icons turned out to eat taps
      // on at least one Android/Chrome phone (its built-in long-press/
      // save-image handling runs underneath normal DOM event dispatch, so
      // `pointer-events: none` didn't reliably stop it). A CSS background on
      // a plain <div> has no such gesture layer at all.
      const img = new Image()
      img.onload = () => { if (!cancelled) setHeroPhotoLoaded(true) }
      img.src = hit.url
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

      // Open-Meteo's forecast only reaches about a week out — beyond that,
      // "today's actual weather" at the destination is not the trip's
      // weather at all, just a number that happens to be on screen. A trip
      // that far ahead gets a climate estimate for its own dates instead.
      if (daysUntil(TRIP.from) > 7 && TRIP.from) {
        const [, month, day] = TRIP.from.split('-').map(Number)
        const c = await fetchClimateAverage(lat, lng, month, day)
        if (!cancelled) setClimate(c)
      } else if (!cancelled) {
        setClimate(null)
      }
    })()

    return () => { cancelled = true }
  }, [TRIP?.id, TRIP?.lat, TRIP?.lng, TRIP?.from])

  // After every hook: an early return above them changes the hook count
  // between renders, which React rejects outright.
  if (!TRIP) return null

  // The "next" stop is the first one still ahead of us today.
  const nextId = STOPS[1]?.id ?? STOPS[0]?.id

  // Beyond Open-Meteo's forecast horizon, "today's weather at the
  // destination" is a real number that has nothing to do with the trip.
  const farOut = daysUntil(TRIP.from) > 7
  const heroWeatherIcon = farOut && climate ? climate.icon : (forecast?.now.icon ?? '☀️')

  return (
    <div className="screen">
      <TopBar variant="home" />

      <div className="pad">
        {/* The night theme's masthead — greeting over a big city name, above
            the photo card. Hidden in the classic theme (styles.css), which
            keeps its greeting inside the card as before. */}
        <div className="home-masthead">
          <p className="home-greet">{forecast ? `${GREETING[forecast.now.period]},` : t('שלום!')}</p>
          <h1 className="home-city">{TRIP.city}<span className="home-dot">.</span></h1>
        </div>
        <section className={`hero ${heroPhoto ? 'has-photo' : ''}`}>
          {heroPhoto && (
            <>
              <div
                aria-hidden="true"
                className={`hero-photo ${heroPhotoLoaded ? 'on' : ''}`}
                style={{ backgroundImage: `url(${heroPhoto.url})` }}
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
            <div className="hero-icon" aria-hidden="true">{heroWeatherIcon}</div>
            <button
              className="icon-btn boxed"
              onClick={() => {
                // Temporary diagnostic — the share sheet was reported not
                // opening on one Android/Chrome phone with no error, no
                // freeze and no render crash anywhere in the telemetry log,
                // which rules out a JS exception. This settles the one
                // remaining question directly: does the tap even reach this
                // handler at all. Remove once that's answered.
                record({ kind: 'debug', level: 'info', message: 'DIAG: share icon tapped (home hero)' })
                setShareOpen(true)
              }}
              aria-label={t('שתף את המסלול')}
            >
              <Share size={17} />
            </button>
          </div>

          <div className="hero-content">
            {/* Neutral until the destination's real local time resolves — a
                placeholder greeting is fine, a wrong one (guessed from the
                visitor's own clock) is not. */}
            <h1 className="hero-title">
              {forecast ? `${GREETING[forecast.now.period]}!` : t('שלום!')}
              {/* Only the gold theme shows this — its greeting sits on the
                  photo as "Good evening, / Baku." */}
              <span className="hero-city">{TRIP.city}.</span>
            </h1>
            {farOut ? (
              climate && (
                <button
                  className="tiny row"
                  style={{ gap: 6, marginTop: 2, flexWrap: 'wrap' }}
                  onClick={() => setForecastOpen(true)}
                >
                  <span
                    className="badge"
                    style={{ background: 'rgba(13,154,150,0.16)', color: 'var(--cyan)', padding: '2px 8px', fontSize: 10.5 }}
                  >
                    {t('ממוצע היסטורי')}
                  </span>
                  <span aria-hidden="true">{climate.icon}</span>
                  <span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
                    <span className="num" dir="ltr">{climate.tempMax}°/{climate.tempMin}°</span>
                    {' '}{t('בתאריכי הטיול')} · <span className="num">{climate.rainChance}%</span> {t('סיכוי לגשם')}
                  </span>
                </button>
              )
            ) : (
              forecast && (
                <button
                  className="tiny row"
                  style={{ gap: 5, marginTop: 2, textDecoration: 'underline', textUnderlineOffset: 3 }}
                  onClick={() => setForecastOpen(true)}
                >
                  <span aria-hidden="true">{forecast.now.icon}</span>
                  <span className="num">{forecast.now.tempC}°</span> {t('ב{city} עכשיו · תחזית', { city: TRIP.city })}
                </button>
              )
            )}
            <p className="sub" style={{ maxWidth: '92%', marginTop: forecast ? 8 : undefined }}>
              {planning
                ? t('הסוכן בונה עכשיו מסלול ל{city}...', { city: TRIP.city })
                : t('הנה התכנון ליום {day} ב{city}, מותאם לסגנון שבחרת.', { day: TRIP.day, city: TRIP.city })}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onStartRoute}>
              {t('התחל מסלול')}
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
            <h2 className="h2" style={{ fontSize: 16 }}>{t('הערות')}</h2>
          </div>
          <button
            onClick={() => setNoteEditing({ isNew: true })}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
          >
            {t('הוסף +')}
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
                aria-label={t('ערוך הערה')}
              >
                <span className="tiny" style={{ lineHeight: 1.6 }}>{n.text}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="tiny">{t('אין עדיין הערות. לדוגמה: פרטי נהג, קוד לדירה, מספר הזמנה.')}</p>
        )}
      </div>

      {/* Split the day by travel party */}
      <div className="pad section-head" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--lav)' }}><Users size={17} /></span>
          <h2 className="h2" style={{ fontSize: 16 }}>{t('מי מטייל')}</h2>
        </div>
        <span className="row" style={{ gap: 14 }}>
          <button
            onClick={() => openEdit('who')}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}
          >
            {t('ערוך')}
          </button>
          <button
            onClick={() => setShareOpen(true)}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
          >
            {t('הזמן חברים +')}
          </button>
        </span>
      </div>

      {FAMILIES.length > 1 && (
        <div className="hscroll chips" style={{ paddingBlock: 0 }}>
          {FAMILIES.map((f) => (
            <button
              key={f.id}
              className={`pill ${activeFamily === f.id ? 'on' : ''}`}
              onClick={() => switchFamily(f.id)}
              title={arrivalTitle(f)}
            >
              <i className="dot" style={{ background: f.color, marginInlineEnd: 6 }} />
              {f.name}
              <span className="tiny" style={{ marginInlineStart: 4 }}>
                (<span className="num">{f.members.length}</span>)
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="pad section-head">
        <h2 className="h2">
          {FAMILIES.length > 1 ? t('התכנון של {name}', { name: FAMILIES.find((f) => f.id === activeFamily)?.name ?? '' }) : t('התכנון להיום')}
        </h2>
        <span className="row" style={{ gap: 10 }}>
          <span className="tiny">
            {t('יום')} <span className="num">{TRIP.day}</span> {t('מתוך')} <span className="num">{TRIP.totalDays}</span>
          </span>
          <button
            className="icon-btn"
            style={{ width: 30, height: 30 }}
            onClick={plan}
            disabled={planning}
            aria-label={t('בנה מסלול מחדש')}
            title={t('בנה מסלול מחדש')}
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
        {STOPS.map((s) => {
          const isNext = s.id === nextId
          return (
            <button key={s.id} className={`timeline-card ${isNext ? 'next' : ''}`} onClick={onStartRoute}>
              <div className="between">
                <span className={`time-chip ${isNext ? 'next' : ''}`}>
                  {isNext && <i className="dot dot-pulse" style={{ display: 'inline-block', marginInlineEnd: 5 }} />}
                  <span className="num">{s.time}</span>
                  {isNext && ` ${t('(הבא)')}`}
                </span>
                <span style={{ color: 'var(--muted-2)' }}><Bookmark size={15} /></span>
              </div>

              <PlacePhoto name={s.name} cat={s.cat} title={s.name} />

              <p className="tiny" style={{ margin: 0 }}>{s.desc}</p>
            </button>
          )
        })}

        {planning && STOPS.length === 0 && (
          <div className="timeline-card" style={{ display: 'grid', placeItems: 'center', height: 180 }}>
            <span className="typing"><i /><i /><i /></span>
          </div>
        )}

        {!planning && STOPS.length === 0 && (
          <div className="timeline-card" style={{ display: 'grid', placeItems: 'center', height: 180 }}>
            <span className="tiny">{t('אין עצירות ליום הזה')}</span>
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
              <strong>{t('שמור כדי לפתוח גם מהטלפון')}</strong>
              <span className="tiny">{t('הטיול קיים כרגע על המכשיר הזה בלבד')}</span>
            </span>
            <ArrowLeft size={17} />
          </button>
        </div>
      )}

      {/* Every card below duplicates a destination the desktop rail already
          shows permanently, so on a wide screen this whole block is just
          the same navigation twice — home-shortcuts hides it there. On
          mobile, with no rail, these cards are the only way in. */}
      <div className="home-shortcuts">
      {/* Recommendations come from the agent, which knows the real itinerary —
          there is no canned list to fall back on. */}
      <div className="pad" style={{ marginTop: 20 }}>
        <button className="card between" style={{ width: "100%" }} onClick={onOpenChat}>
          <span className="row">
            <span className="fab-spark" style={{ width: 34, height: 34 }}>
              <Sparkles size={17} />
            </span>
            <span className="col" style={{ gap: 2, textAlign: "start" }}>
              <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('שאל את הסוכן')}</strong>
              <span className="tiny">{t('המלצות להמשך היום, לפי המסלול שלך')}</span>
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
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('מסלול הטיול')}</strong>
                <span className="tiny">
                  <span className="num">{TRIP.totalDays}</span> {tn(TRIP.totalDays, 'יום אחד', 'ימים')} · {t('הוסף עצירות ושנה סדר')}
                </span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onOpenFood}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Utensils size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('איפה אוכלים')}</strong>
                <span className="tiny">{t('המלצות מסעדות לפי ההעדפות שלכם')}</span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onOpenArrival}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Plane size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('הגעה ליעד')}</strong>
                <span className="tiny">{t('טיסה, שדה תעופה והדרך למלון')}</span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onOpenHotels}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Bed size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('מלונות')}</strong>
                <span className="tiny">
                  {TRIP.stays?.length > 0
                    ? tn(TRIP.stays.length, 'מקום לינה אחד', '{n} מקומות לינה')
                    : t('עוד לא הוספתם מלון')}
                </span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onOpenSummary}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Printer size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('סיכום להדפסה')}</strong>
                <span className="tiny">{t('כל הימים במסמך אחד, לשיתוף או הדפסה')}</span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          <button className="card between" style={{ width: '100%' }} onClick={onStartRoute}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Clock size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('הלו"ז המלא של היום')}</strong>
                <span className="tiny">
                  <span className="num">{STOPS.length}</span> {tn(STOPS.length, 'עצירה', 'עצירות')} · {t('מסתיים ב-')}
                  <span className="num">{STOPS[STOPS.length - 1]?.time ?? '—'}</span>
                </span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>

          {/* The account icon up in the top bar already opens this same
              list — it just turns out nobody finds it there. Last in this
              list rather than first, since switching trips is rarer than
              anything above it. */}
          <button className="card between" style={{ width: '100%' }} onClick={openAccount}>
            <span className="row">
              <span style={{ color: 'var(--lav)' }}><Layers size={18} /></span>
              <span className="col" style={{ gap: 2, textAlign: 'start' }}>
                <strong style={{ fontSize: 14, fontWeight: 600 }}>{t('הטיולים שלי')}</strong>
                <span className="tiny">
                  {trips.length > 1 ? t('עבור בין {n} הטיולים שלך', { n: trips.length }) : t('שמור, שתף או תכנן טיול נוסף')}
                </span>
              </span>
            </span>
            <ArrowLeft size={18} />
          </button>
        </div>
      </div>
      </div>

      <ShareSheet open={shareOpen} stops={STOPS} onClose={() => setShareOpen(false)} />
      <WeatherSheet
        open={forecastOpen}
        onClose={() => setForecastOpen(false)}
        forecast={forecast}
        climate={farOut ? climate : null}
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
