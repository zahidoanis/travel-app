import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import { Sparkles, Plus, Navigation, Check, Ticket, Send, Star, MapPin } from '../components/Icons'
import BookingSheet from '../components/BookingSheet'
import { CUISINES } from '../data'
import { useTrip } from '../TripProvider'
import { hasAI, complete, completeWithMaps, parseRows } from '../lib/gemini'
import { geocode } from '../lib/geocode'
import { sameName } from '../lib/text'
import { breadcrumb, watchdog } from '../lib/telemetry'
import { t, locale } from '../i18n'

/** One-tap searches for the questions people actually ask. */
const QUICK = [
  { id: 'near', label: t('ליד המסלול של היום') },
  { id: 'q', label: t('ארוחת בוקר טובה') },
  { id: 'q', label: t('מקום רומנטי לערב') },
  { id: 'q', label: t('זול וטעים') },
  { id: 'q', label: t('עם נוף') },
]

export default function Restaurants() {
  const { trip, profile, activeDay, addStop, stops } = useTrip()

  // Seeded from the onboarding answer, then filterable here.
  const [picked, setPicked] = useState(() => profile?.cuisines ?? ['local'])
  // A free-text request — "a romantic bistro near the Louvre, under €40" —
  // on top of the cuisine filters, the way you'd ask a person.
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState(null) // what the list on screen answers
  const [list, setList] = useState([])
  const [grounded, setGrounded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(null)
  const [added, setAdded] = useState([])
  const [booking, setBooking] = useState(null)
  // A search asked for in the box lands below the filters — bring the
  // answer into view rather than leave it a scroll away.
  const resultsRef = useRef(null)
  const reveal = (asked) => asked && setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)

  const find = async ({ q = query, cuisines = picked, near = false } = {}) => {
    if (loading || !hasAI) return
    breadcrumb('action', `restaurant search${q ? ' (free text)' : ''}${near ? ' (near route)' : ''}`)
    setLoading(true)
    setError(null)
    const done = watchdog('restaurants.search', 45000, { city: trip.city })

    const names = CUISINES.filter((c) => cuisines.includes(c.id)).map((c) => c.label).join(', ')
    const located = stops.filter((s) => s.lat != null && s.lng != null)
    // "Near today's route": centre the Maps search on today's stops instead
    // of the city as a whole.
    const center = near && located.length > 0
      ? {
          latitude: located.reduce((a, s) => a + s.lat, 0) / located.length,
          longitude: located.reduce((a, s) => a + s.lng, 0) / located.length,
        }
      : trip.lat != null ? { latitude: trip.lat, longitude: trip.lng } : null

    const request =
      `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore — AI prompt; see gemini.js language override
      (q ? `הבקשה של המשתמש — זה העיקר: ${q}\n` : '') + // i18n-ignore
      `העדפות מטבח: ${names || 'ללא העדפה'}\n` + // i18n-ignore
      (near && located.length > 0 ? `קרוב לעצירות של היום: ${located.map((s) => s.he || s.name).join(', ')}\n` : '') + // i18n-ignore
      '\nהצע 6 מסעדות אמיתיות שמתאימות לבקשה.' // i18n-ignore

    setAsked(near ? t('ליד המסלול של היום') : q || null)

    try {
      // First choice: grounded in Google Maps — real places with Google's
      // own rating, review count, price range and address.
      const { text, places } = await completeWithMaps({
        latLng: center,
        system:
          'אתה סוכן קולינרי שמשתמש בנתוני Google Maps. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt
          'שם המסעדה בדיוק כפי שהוא מופיע ב-Google Maps | אזור | סוג מטבח | משפט אחד למה היא מתאימה לבקשה\n' + // i18n-ignore
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 6 שורות. הכל בעברית פרט לשם המסעדה.', // i18n-ignore
        prompt: request + ' בסס את ההמלצות על נתוני Google Maps.', // i18n-ignore
      })
      const rows = parseRows(text, ['name', 'area', 'kind', 'reason'])
        .map((r) => ({ ...r, maps: places.find((p) => sameName(p.title, r.name)) ?? null }))
      // Places Maps actually knows come first; a row the model named without
      // Maps data behind it only stays if there'd otherwise be too few.
      const verified = rows.filter((r) => r.maps)
      if (rows.length === 0) throw new Error('empty')
      setList(verified.length >= 3 ? verified : rows)
      setGrounded(verified.length > 0)
      reveal(q || near)
    } catch {
      // Maps grounding unavailable (a spent free quota, most likely): the
      // plain list, honestly labelled as unverified.
      try {
        const text = await complete({
          system:
            'אתה סוכן קולינרי. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt
            'שם המסעדה באנגלית | אזור | סוג מטבח | טווח מחיר לסועד | משפט אחד למה כדאי\n' + // i18n-ignore
            'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 6 שורות. הכל בעברית פרט לשם המסעדה.', // i18n-ignore
          prompt: request,
        })
        const rows = parseRows(text, ['name', 'area', 'kind', 'price', 'reason']).map((r) => ({ ...r, maps: null }))
        if (rows.length === 0) setError(t('לא הצלחתי לפענח את התשובה. נסה שוב.'))
        setList(rows)
        setGrounded(false)
        reveal(q || near)
      } catch (err) {
        setError(err.message)
      }
    } finally {
      done()
      setLoading(false)
    }
  }

  // Fetch once on arrival so the screen is never empty for no reason.
  useEffect(() => {
    if (trip && hasAI && list.length === 0) find()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip])

  // After every hook: an early return above them changes the hook count
  // between renders, which React rejects outright.
  if (!trip) return null

  const toggle = (id) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
    if (next.length === 0) return
    setPicked(next)
  }

  /** Adds a restaurant to the current day, positioned at a mealtime. */
  const addToDay = async (r) => {
    setAdding(r.name)
    // Google's own address pins it far more reliably than name + city.
    const hit = (r.maps?.address && (await geocode(`${r.name}, ${r.maps.address}`))) || (await geocode(`${r.name}, ${trip.city}`))
    setAdding(null)

    if (!hit) {
      setError(t('לא הצלחתי לאתר את "{name}" על המפה.', { name: r.name }))
      return
    }

    addStop(activeDay, {
      name: r.name,
      he: r.name,
      desc: `${r.kind} · ${r.reason}`,
      time: '19:30',
      cat: 'food',
      rating: r.maps?.rating ?? null,
      lat: hit.lat,
      lng: hit.lng,
    })
    setAdded((a) => [...a, r.name])
  }

  const submit = (e) => {
    e?.preventDefault()
    find({ q: query.trim() })
  }

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <h1 className="h1" style={{ fontSize: 24 }}>{t('איפה אוכלים')}</h1>
        <p className="tiny" style={{ marginTop: 4 }}>
          {t('המלצות ב{city} לפי ההעדפות שלכם', { city: trip.city })}
        </p>
      </div>

      <div className="pad" style={{ marginTop: 16 }}>
        {/* Ask the way you'd ask a person — the cuisine filters below still
            apply on top. */}
        <form className="row field-row food-search" onSubmit={submit}>
          <Sparkles size={17} />
          <input
            className="field-bare"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('מה בא לכם? למשל: ביסטרו רומנטי ליד הלובר, עד 40€')}
            aria-label={t('חיפוש מסעדות')}
            enterKeyHint="search"
          />
          <button type="submit" className="send" disabled={loading || !hasAI} aria-label={t('חפש')}>
            <Send size={16} />
          </button>
        </form>

        <div className="pills quick-searches" style={{ marginTop: 10 }}>
          {QUICK.map(({ id, label }) => (
            <button
              key={label}
              className="pill"
              disabled={loading || (id === 'near' && stops.length === 0)}
              onClick={() => {
                if (id === 'near') return find({ q: '', near: true })
                setQuery(label)
                find({ q: label })
              }}
            >
              {id === 'near' && <MapPin size={13} style={{ marginInlineEnd: 5 }} />}
              {label}
            </button>
          ))}
        </div>

        <span className="label" style={{ marginTop: 18 }}>{t('סינון לפי מטבח')}</span>
        <div className="pills">
          {CUISINES.map((c) => (
            <button
              key={c.id}
              className={`pill ${picked.includes(c.id) ? 'on' : ''}`}
              onClick={() => toggle(c.id)}
              aria-pressed={picked.includes(c.id)}
            >
              <span style={{ marginInlineEnd: 6 }} aria-hidden="true">{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>

        <button
          className={`btn btn-block ${loading ? 'btn-ghost' : 'btn-primary'}`}
          style={{ marginTop: 16 }}
          onClick={submit}
          disabled={loading || !hasAI}
          aria-busy={loading}
        >
          {loading ? (
            <><span className="typing"><i /><i /><i /></span> {t('מחפש ב{city}...', { city: trip.city })}</>
          ) : (
            <><Sparkles size={16} /> {t('הצג המלצות')}</>
          )}
        </button>

        {!hasAI && (
          <p className="tiny" style={{ marginTop: 12 }}>
            {t('המלצות מסעדות דורשות חיבור לסוכן ה-AI.')}
          </p>
        )}

        {error && <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>}

        <div ref={resultsRef} style={{ scrollMarginTop: 80 }} />
        {asked && !loading && list.length > 0 && (
          <p className="tiny" style={{ marginTop: 18 }}>
            {t('תוצאות עבור:')} <strong>{asked}</strong>
          </p>
        )}

        <div className="col" style={{ gap: 10, marginTop: asked ? 8 : 20 }}>
          {/* While searching: the shape of the cards that are coming. */}
          {loading && [0, 1, 2].map((i) => (
            <div key={i} className="card skeleton-card" aria-hidden="true">
              <span className="skeleton" style={{ width: '50%', height: 16 }} />
              <span className="skeleton" style={{ width: '30%', height: 10, marginTop: 8 }} />
              <span className="skeleton" style={{ width: '92%', height: 10, marginTop: 14 }} />
              <span className="skeleton" style={{ width: '70%', height: 10, marginTop: 6 }} />
            </div>
          ))}
          {!loading && list.map((r) => {
            const on = added.includes(r.name)
            const price = r.maps?.price ?? r.price
            return (
              <div key={r.name} className="card">
                <div className="between" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 15, fontWeight: 600, display: 'block' }}>
                      {r.name}
                    </strong>
                    <span className="tiny">{r.area} · {r.kind}</span>
                  </span>
                  {price && <span className="hotel-price num">{price}</span>}
                </div>

                {/* The rating is Google's own, read from the Maps data the
                    answer was grounded in — never a number the model wrote.
                    Attributed and linked, as Google's terms ask. */}
                {r.maps?.rating != null ? (
                  <a className="maps-rating" href={r.maps.uri} target="_blank" rel="noopener noreferrer">
                    <Star size={14} />
                    <strong className="num">{r.maps.rating.toFixed(1)}</strong>
                    {r.maps.reviews != null && (
                      <span className="num">({r.maps.reviews.toLocaleString(locale)} {t('ביקורות')})</span>
                    )}
                    <span className="maps-rating-src">· Google Maps</span>
                  </a>
                ) : (
                  <span className="badge" style={{ marginBottom: 8 }}>
                    <Sparkles size={11} /> {t('המלצת AI, לא ביקורת מאומתת')}
                  </span>
                )}

                <p className="tiny" style={{ margin: '6px 0 4px' }}>{r.reason}</p>
                {r.maps?.address && (
                  <p className="tiny" style={{ margin: '0 0 10px', opacity: 0.85 }} dir="auto">{r.maps.address}</p>
                )}

                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <button
                    className={`btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => !on && addToDay(r)}
                    disabled={adding === r.name || on}
                  >
                    {adding === r.name ? (
                      <span className="typing"><i /><i /><i /></span>
                    ) : on ? (
                      <><Check size={14} /> {t('נוסף ליום {day}', { day: activeDay })}</>
                    ) : (
                      <><Plus size={14} /> {t('הוסף ליום {day}', { day: activeDay })}</>
                    )}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setBooking(r)}>
                    <Ticket size={14} />
                    {t('הזמן מקום')}
                  </button>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={r.maps?.uri ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${trip.city}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation size={14} />
                    {t('במפה')}
                  </a>
                </div>
              </div>
            )
          })}
        </div>

        <BookingSheet
          open={Boolean(booking)}
          place={booking}
          kind="food"
          onClose={() => setBooking(null)}
        />

        {!loading && list.length > 0 && (
          <p className="tiny" style={{ marginTop: 14 }}>
            {grounded
              ? t('דירוגים, מחירים וכתובות מ-Google Maps. ההסבר ליד כל מסעדה נכתב על ידי הסוכן — ודאו שעות פתיחה לפני שמגיעים.')
              : t('ההמלצות נוצרו על ידי מודל שפה — ודאו שעות פתיחה וזמינות לפני שמגיעים.')}
          </p>
        )}
      </div>
    </div>
  )
}
