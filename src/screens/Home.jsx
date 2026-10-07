import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import ShareSheet from '../components/ShareSheet'
import {
  ArrowLeft, Share, Images, Users, RefreshCw, Utensils, Cloud, Plane, Note, Layers, Bed, Printer, Plus,
} from '../components/Icons'
import { useTrip } from '../TripProvider'
import PlacePhoto from '../components/PlacePhoto'
import { heroPhoto as fetchHeroPhoto } from '../lib/photos'
import { fetchForecast, fetchClimateAverage, GREETING } from '../lib/weather'
import { geocode } from '../lib/geocode'
import { CITIES } from '../cities'
import WeatherSheet from '../components/WeatherSheet'
import NoteSheet from '../components/NoteSheet'
import { THEME } from '../theme'
import { t, lang } from '../i18n'

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


export default function Home({ onStartRoute, onOpenChat, onOpenDays, onOpenFood, onOpenArrival, onOpenHotels, onOpenSummary, onOpenJournal }) {
  const {
    trip: TRIP, stops: STOPS, families: FAMILIES, activeFamily, switchFamily,
    planning, planWarning, plan, syncState, planningDay,
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

  // Where the trip is in time decides what the one button on the photo
  // does. "התחל מסלול" (start route) made no sense seventeen days out.
  const phase = daysUntil(TRIP.from) > 0 ? 'before' : TRIP.to && daysUntil(TRIP.to) < 0 ? 'after' : 'during'
  const cta = {
    before: { label: t('ראו את התכנון'), onClick: onOpenDays },
    during: { label: t('נווטו לעצירה הבאה'), onClick: onStartRoute },
    after: { label: t('סיכום הטיול'), onClick: onOpenSummary },
  }[phase]

  // The themes that set the city on the photo read "ערב טוב, / פריז." —
  // a comma, not the "!" that ends the greeting when it stands alone.
  const greet = forecast ? GREETING[forecast.now.period] : t('שלום!').replace(/!$/, '')
  const cityOnPhoto = Boolean(heroPhoto) && (THEME === 'cream' || THEME === 'gold')

  const travellerCount = FAMILIES.reduce((n, f) => n + f.members.length, 0)

  // Details the first-run questionnaire no longer asks up front — offered
  // here instead, one tap each, until they're filled in.
  const missing = [
    !TRIP.stays?.length && { id: 'stay', label: t('מלון'), Icon: Bed },
    !(TRIP.flight?.number || TRIP.flight?.airline) && { id: 'flight', label: t('טיסה'), Icon: Plane },
    (TRIP.cuisines.length === 0 || (TRIP.cuisines.length === 1 && TRIP.cuisines[0] === 'local')) &&
      { id: 'food', label: t('העדפות אוכל'), Icon: Utensils },
  ].filter(Boolean)

  const shortcuts = [
    { Icon: Utensils, label: t('מסעדות'), onClick: onOpenFood },
    { Icon: Plane, label: t('הגעה'), onClick: onOpenArrival },
    { Icon: Bed, label: t('מלונות'), onClick: onOpenHotels },
    { Icon: Printer, label: t('סיכום להדפסה'), onClick: onOpenSummary },
    { Icon: Images, label: t('יומן הטיול'), onClick: onOpenJournal },
    { Icon: Layers, label: t('הטיולים שלי'), onClick: openAccount },
  ]

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        {/* The night theme's masthead — greeting over a big city name, above
            the photo card. Hidden in the other themes (styles.css), which
            keep the greeting inside the card. */}
        <div className="home-masthead">
          <p className="home-greet">{greet},</p>
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
                  the one card everyone sees first. */}
              <div className="hero-scrim" style={{ '--tod-tint': TOD_TINT[forecast?.now.period ?? 'noon'] }} />
            </>
          )}

          {/* Its own layer, not part of the bottom-anchored text block below —
              with a photo the card grows tall enough that grouping these
              with the title would strand them at the bottom. */}
          {/* Share only. The weather emoji that sat in the opposite corner was a
              boxed icon that looked like a button and did nothing — the
              weather line below the greeting already shows it. */}
          <div className="hero-top-row" style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="icon-btn boxed"
              onClick={() => setShareOpen(true)}
              aria-label={t('שתף את המסלול')}
            >
              <Share size={17} />
            </button>
          </div>

          <div className="hero-content">
            <h1 className="hero-title">
              {cityOnPhoto ? `${greet},` : `${greet}!`}
              {/* Only the cream and gold themes show this — the greeting sits
                  on the photo as "Good evening, / Paris." */}
              <span className="hero-city">{TRIP.city}.</span>
            </h1>
            {farOut ? (
              climate && (
                <button className="hero-chip" onClick={() => setForecastOpen(true)}>
                  <span aria-hidden="true">{climate.icon}</span>
                  <span className="num" dir="ltr">{climate.tempMax}°/{climate.tempMin}°</span>
                  <span>· <span className="num">{climate.rainChance}%</span> {t('סיכוי לגשם')}</span>
                  <span className="hero-chip-note">{t('ממוצע היסטורי')}</span>
                </button>
              )
            ) : (
              forecast && (
                <button className="hero-chip" onClick={() => setForecastOpen(true)}>
                  <span aria-hidden="true">{forecast.now.icon}</span>
                  <span className="num">{forecast.now.tempC}°</span> {t('ב{city} עכשיו · תחזית', { city: TRIP.city })}
                </button>
              )
            )}
            <p className="sub" style={{ maxWidth: '92%', marginTop: 8 }}>
              {planning
                ? planningDay && TRIP.totalDays > 1
                  ? t('הסוכן בונה את המסלול ל{city} — יום {day} מתוך {total}...', { city: TRIP.city, day: planningDay, total: TRIP.totalDays })
                  : t('הסוכן בונה עכשיו מסלול ל{city}...', { city: TRIP.city })
                : t('הנה התכנון ליום {day} ב{city}, מותאם לסגנון שבחרת.', { day: TRIP.day, city: TRIP.city })}
            </p>
            <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={cta.onClick}>
              {cta.label}
              <ArrowLeft size={17} className="dir-flip" />
            </button>
          </div>
        </section>
      </div>

      {/* The plan comes straight after the photo — it is what this screen
          is for. It used to sit under notes and "who's traveling", below
          the first screenful on a phone. */}
      <div className="pad section-head">
        <h2 className="h2">
          {FAMILIES.length > 1 ? t('התכנון של {name}', { name: FAMILIES.find((f) => f.id === activeFamily)?.name ?? '' }) : t('התכנון להיום')}
        </h2>
        <span className="row" style={{ gap: 4 }}>
          <span className="tiny">
            {t('יום')} <span className="num">{TRIP.day}</span> {t('מתוך')} <span className="num">{TRIP.totalDays}</span>
          </span>
          <button
            className="icon-btn"
            onClick={() => plan()}
            disabled={planning}
            aria-label={t('בנה מסלול מחדש')}
            title={t('בנה מסלול מחדש')}
          >
            <RefreshCw size={16} />
          </button>
        </span>
      </div>

      {FAMILIES.length > 1 && (
        <div className="hscroll chips" style={{ paddingBlock: 0, marginBottom: 6 }}>
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
              </div>

              <PlacePhoto name={s.name} cat={s.cat} title={s.he || s.name} />

              <p className="tiny" style={{ margin: 0 }}>{s.desc}</p>
            </button>
          )
        })}

        {/* Shaped like the cards that are coming, not one empty box with
            three dots — the wait reads as "loading the plan". */}
        {planning && STOPS.length === 0 && [0, 1, 2].map((i) => (
          <div key={i} className="timeline-card skeleton-card" aria-hidden="true">
            <span className="skeleton" style={{ width: 64, height: 14 }} />
            <span className="skeleton" style={{ height: 96, margin: '10px 0' }} />
            <span className="skeleton" style={{ width: '85%', height: 10 }} />
            <span className="skeleton" style={{ width: '60%', height: 10, marginTop: 6 }} />
          </div>
        ))}
        {planning && STOPS.length === 0 && (
          <span className="sr-only" role="status">{t('הסוכן בונה את היום...')}</span>
        )}

        {!planning && STOPS.length === 0 && (
          <div className="timeline-card" style={{ display: 'grid', placeItems: 'center', height: 180 }}>
            <span className="tiny">{t('אין עצירות ליום הזה')}</span>
          </div>
        )}
      </div>

      {/* The one "next step" for this trip, in place of the three separate
          save prompts there used to be (top bar, card, rail). */}
      {(syncState === 'device' || missing.length > 0) && (
        <div className="pad col" style={{ gap: 10, marginTop: 20 }}>
          {syncState === 'device' && (
            <button className="save-prompt" onClick={openAccount}>
              <span className="save-icon"><Cloud size={17} /></span>
              <span className="grow col" style={{ gap: 3, textAlign: 'start' }}>
                <strong>{t('שמרו את הטיול בחשבון')}</strong>
                <span className="tiny">{t('כרגע הוא שמור רק בדפדפן הזה. התחברות שומרת אותו לכל מכשיר.')}</span>
              </span>
              <ArrowLeft size={17} className="dir-flip" />
            </button>
          )}
          {missing.length > 0 && (
            <div className="card complete-card">
              <strong style={{ fontSize: 14.5 }}>{t('השלימו את הטיול')}</strong>
              <span className="tiny" style={{ display: 'block', marginTop: 2 }}>
                {t('כמה פרטים שיעזרו לסוכן לדייק את ההמלצות')}
              </span>
              <div className="pills" style={{ marginTop: 12 }}>
                {missing.map(({ id, label, Icon }) => (
                  <button key={id} className="pill" onClick={() => openEdit(id)}>
                    <Icon size={14} style={{ marginInlineEnd: 6 }} />
                    {label}
                    <Plus size={13} style={{ marginInlineStart: 6 }} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* General trip notes — a driver's name, a booking code, anything
          that isn't tied to one stop on the map and so has no other home. */}
      <div className="pad section-head" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--lav)' }}><Note size={17} /></span>
          <h2 className="h2" style={{ fontSize: 16 }}>{t('הערות')}</h2>
        </div>
        <button className="text-btn" onClick={() => setNoteEditing({ isNew: true })}>
          {t('הוסף +')}
        </button>
      </div>
      <div className="pad">
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

      <div className="pad section-head" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--lav)' }}><Users size={17} /></span>
          <h2 className="h2" style={{ fontSize: 16 }}>{t('מי מטייל')}</h2>
          <span className="tiny">
            · {travellerCount === 1 ? t('נוסע אחד') : t('{n} נוסעים', { n: travellerCount })}
          </span>
        </div>
        <span className="row" style={{ gap: 4 }}>
          <button className="text-btn muted" onClick={() => openEdit('who')}>{t('ערוך')}</button>
          <button className="text-btn" onClick={() => setShareOpen(true)}>{t('הזמן חברים +')}</button>
        </span>
      </div>

      {/* Phones only — the desktop rail already lists every one of these.
          The agent, the route and the full schedule are in the bottom bar,
          so they're not repeated here. */}
      <div className="pad home-shortcuts" style={{ marginTop: 22 }}>
        <h2 className="h2" style={{ fontSize: 16, marginBottom: 12 }}>{t('עוד בטיול')}</h2>
        <div className="shortcut-grid">
          {shortcuts.map(({ Icon, label, onClick }) => (
            <button key={label} className="shortcut" onClick={onClick}>
              <span className="shortcut-icon"><Icon size={19} /></span>
              <span>{label}</span>
            </button>
          ))}
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
