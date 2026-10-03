import { useEffect, useState } from 'react'
import TopBar from '../components/TopBar'
import { Sparkles, Plus, Navigation, Check, Ticket } from '../components/Icons'
import BookingSheet from '../components/BookingSheet'
import { CUISINES } from '../data'
import { useTrip } from '../TripProvider'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { geocodeNear } from '../lib/geocode'
import { navigateUrl } from '../lib/staticMap'
import { breadcrumb, watchdog } from '../lib/telemetry'
import { t } from '../i18n'

// The screen remounts on every visit to its tab, and each visit used to ask
// the AI for six new restaurants — one request from a daily free quota of a
// few hundred, spent on opening a tab. Kept for the session; searching again
// on purpose still asks afresh.
const suggestionCache = new Map()
const cacheKey = (trip, cuisines) => `${trip?.id}|${[...cuisines].sort().join(',')}`

export default function Restaurants() {
  const { trip, profile, activeDay, addStop } = useTrip()

  // Seeded from the onboarding answer, then filterable here.
  const [picked, setPicked] = useState(() => profile?.cuisines ?? ['local'])
  const [list, setList] = useState(() => suggestionCache.get(cacheKey(trip, picked)) ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(null)
  const [added, setAdded] = useState([])
  const [booking, setBooking] = useState(null)


  const find = async (cuisines = picked) => {
    if (loading || !hasAI) return
    breadcrumb('action', 'restaurant search')
    setLoading(true)
    setError(null)
    const done = watchdog('restaurants.search', 30000, { city: trip.city })

    const names = CUISINES.filter((c) => cuisines.includes(c.id)).map((c) => c.label).join(', ')

    try {
      const text = await complete({
        system:
          'אתה סוכן קולינרי. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt; see gemini.js language override
          'שם המסעדה באנגלית | אזור | סוג מטבח | טווח מחיר לסועד | משפט אחד למה כדאי\n' + // i18n-ignore
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 6 שורות. הכל בעברית פרט לשם המסעדה.', // i18n-ignore
        prompt:
          `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore
          `העדפות: ${names || 'ללא העדפה'}\n\n` + // i18n-ignore
          'הצע 6 מסעדות אמיתיות שמתאימות להעדפות.', // i18n-ignore
      })

      const rows = parseRows(text, ['name', 'area', 'kind', 'price', 'reason'])
      if (rows.length === 0) setError(t('לא הצלחתי לפענח את התשובה. נסה שוב.'))
      else suggestionCache.set(cacheKey(trip, cuisines), rows)
      setList(rows)
    } catch (err) {
      setError(err.message)
    } finally {
      done()
      setLoading(false)
    }
  }

  // Fetch once on arrival so the screen is never empty for no reason — and
  // only once per trip and choice of cuisines in a session (see
  // suggestionCache), not on every visit to the tab.
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
    // The day on screen when it was tapped, not after the lookup.
    const day = activeDay
    setAdding(r.name)
    const hit = await geocodeNear(r.name, trip)
    setAdding(null)

    if (!hit) {
      setError(t('לא הצלחתי לאתר את "{name}" על המפה.', { name: r.name }))
      return
    }

    const added = addStop(day, {
      name: r.name,
      he: r.name,
      desc: `${r.kind} · ${r.reason}`,
      time: '19:30',
      cat: 'food',
      rating: null,
      lat: hit.lat,
      lng: hit.lng,
    })
    if (!added) setError(t('"{name}" כבר נמצא ביום {day}.', { name: r.name, day }))
    setAdded((a) => [...a, r.name])
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

      <div className="pad" style={{ marginTop: 18 }}>
        <span className="label">{t('סינון לפי מטבח')}</span>
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
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          onClick={() => find()}
          disabled={loading || !hasAI}
        >
          {loading ? (
            <><span className="typing"><i /><i /><i /></span> {t('מחפש ב{city}...', { city: trip.city })}</>
          ) : (
            <><Sparkles size={16} /> {t('רענן המלצות')}</>
          )}
        </button>

        {!hasAI && (
          <p className="tiny" style={{ marginTop: 12 }}>
            {t('המלצות מסעדות דורשות חיבור לסוכן ה-AI.')}
          </p>
        )}

        {error && <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>}

        <div className="col" style={{ gap: 10, marginTop: 20 }}>
          {list.map((r) => {
            const on = added.includes(r.name)
            return (
              <div key={r.name} className="card">
                <div className="between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 15, fontWeight: 600, display: 'block' }}>
                      {r.name}
                    </strong>
                    <span className="tiny">{r.area} · {r.kind}</span>
                  </span>
                  <span className="hotel-price num">{r.price}</span>
                </div>

                <p className="tiny" style={{ margin: '0 0 9px' }}>{r.reason}</p>
                {/* Not a real review or rating — the model has no verified
                    source for either, and saying so plainly beats a card
                    that looks like Google/TripAdvisor but isn't one. */}
                <span className="badge" style={{ marginBottom: 9 }}>
                  <Sparkles size={11} /> {t('המלצת AI, לא ביקורת מאומתת')}
                </span>

                <div className="row" style={{ gap: 8 }}>
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
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${r.name}, ${trip.city}`
                    )}`}
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

        {list.length > 0 && (
          <p className="tiny" style={{ marginTop: 14 }}>
            {t('ההמלצות נוצרו על ידי מודל שפה — ודאו שעות פתיחה וזמינות לפני שמגיעים.')}
          </p>
        )}
      </div>
    </div>
  )
}
