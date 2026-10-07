import { useState } from 'react'
import TopBar from '../components/TopBar'
import { Plane, Car, Sparkles, Info, Navigation, Clock, Plus } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { breadcrumb, watchdog } from '../lib/telemetry'
import { t } from '../i18n'

/**
 * Getting from the airport to where you sleep.
 *
 * The agent is good at this: which options exist, roughly how long each takes,
 * what they cost, what to watch out for. It is not a live flight tracker and
 * is not asked to behave like one — scheduled times come from the airline, and
 * the flight card links straight to a real tracker instead of inventing them.
 */
export default function Arrival() {
  const { trip, profile, openEdit } = useTrip()

  const [options, setOptions] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const flight = profile?.flight ?? {}
  const stay = trip?.stays?.[0]

  // Google Flights takes a plain-language query and prefills the search from
  // it. Skyscanner and Kayak want IATA codes in the path, which we do not
  // have — a city name there just 404s — so the second link is an ordinary
  // search that surfaces every comparison site instead of guessing at one.
  const origin = t('תל אביב')
  const englishCity = trip?.cityEn ?? trip?.city ?? ''
  const query = `Flights from Tel Aviv to ${englishCity} on ${trip?.from ?? ''} through ${trip?.to ?? ''}`
  const googleFlights = `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`
  const compare = `https://www.google.com/search?q=${encodeURIComponent(
    t('טיסות תל אביב {city} {date}', { city: trip?.city ?? '', date: trip?.from ?? '' })
  )}`

  const ask = async () => {
    if (loading || !hasAI) return
    breadcrumb('action', 'transfer options requested')
    setLoading(true)
    setError(null)
    const done = watchdog('arrival.options', 35000, { city: trip?.city })

    const dest = stay ? `${stay.name} (${stay.label})` : t('מרכז {city}', { city: trip.city })

    try {
      const text = await complete({
      kind: 'arrival',
        system:
          'אתה סוכן נסיעות מקומי. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt; see gemini.js language override
          'אמצעי | זמן נסיעה משוער | טווח מחיר | משפט אחד עם טיפ מעשי\n' + // i18n-ignore
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 5 שורות, מהזול ליקר.\n' + // i18n-ignore
          'כלול רכבת/מטרו אם קיימת, שאטל, מונית מוסדרת, והסעה פרטית מוזמנת מראש.', // i18n-ignore
        prompt:
          `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore
          (flight.arrivalAirport ? `שדה תעופה: ${flight.arrivalAirport}\n` : '') + // i18n-ignore
          (flight.arrivalTime ? `שעת נחיתה מתוכננת: ${flight.arrivalTime}\n` : '') + // i18n-ignore
          `יעד: ${dest}\n` + // i18n-ignore
          `נוסעים: ${profile?.parties?.reduce((n, p) => n + p.members.length, 0) ?? 2}\n\n` + // i18n-ignore
          'איך מגיעים משדה התעופה ליעד?', // i18n-ignore
      })

      const rows = parseRows(text, ['mode', 'duration', 'price', 'tip'])
      // An answer in some other shape used to leave the screen exactly as it
      // was, as though the button had not been pressed.
      if (rows.length === 0) setError(t('לא הצלחתי לפענח את התשובה. נסה שוב.'))
      setOptions(rows)
    } catch (err) {
      setError(err.message)
    } finally {
      done()
      setLoading(false)
    }
  }

  const askDrivers = async () => {
    if (loading || !hasAI) return
    breadcrumb('action', 'driver services requested')
    setLoading(true)
    setError(null)
    const done = watchdog('arrival.drivers', 35000, { city: trip?.city })

    try {
      const text = await complete({
      kind: 'arrival',
        system:
          'אתה סוכן נסיעות מקומי. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore
          'שם השירות | סוג | טווח מחיר להסעה משדה התעופה | משפט אחד למה מומלץ\n' + // i18n-ignore
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות.\n' + // i18n-ignore
          'רק שירותים אמיתיים ומוכרים בעיר. אם אינך בטוח שקיים — אל תמציא.', // i18n-ignore
        prompt:
          `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n\n` + // i18n-ignore
          'אילו שירותי הסעה והורדה מהשדה מוכרים ואמינים שם? כולל אפליקציות מקומיות.', // i18n-ignore
      })

      const rows = parseRows(text, ['name', 'kind', 'price', 'why'])
      if (rows.length === 0) setError(t('לא הצלחתי לפענח את התשובה. נסה שוב.'))
      setDrivers(rows)
    } catch (err) {
      setError(err.message)
    } finally {
      done()
      setLoading(false)
    }
  }

  if (!trip) return null

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <h1 className="h1" style={{ fontSize: 24 }}>{t('הגעה ליעד')}</h1>
        <p className="tiny" style={{ marginTop: 4 }}>
          {t('משדה התעופה עד {place}', { place: stay ? stay.name : t('מרכז {city}', { city: trip.city }) })}
        </p>
      </div>

      {/* Searching for a flight.
          The agent cannot do this — it has no live data and would quote
          prices from months-old training. One tap to a real search is worth
          more than a confident guess. */}
      <div className="pad" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="row" style={{ gap: 9, marginBottom: 12 }}>
            <span className="contact-icon"><Plane size={15} /></span>
            <span className="col" style={{ gap: 2 }}>
              <strong style={{ fontSize: 15, fontWeight: 600 }}>{t('חיפוש טיסות')}</strong>
              <span className="tiny">
                {origin} → {trip.city} · <span className="num">{trip.from}</span> {t('עד')}{' '}
                <span className="num">{trip.to}</span>
              </span>
            </span>
          </div>

          <div className="row" style={{ gap: 9 }}>
            <a
              className="btn btn-primary btn-sm grow"
              href={googleFlights}
              target="_blank"
              rel="noreferrer"
            >
              <Plane size={14} />
              Google Flights
            </a>
            <a
              className="btn btn-ghost btn-sm grow"
              href={compare}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={14} />
              {t('השוואת מחירים')}
            </a>
          </div>

          <div className="row" style={{ alignItems: 'flex-start', gap: 9, marginTop: 12 }}>
            <span style={{ color: 'var(--muted)' }}><Info size={14} /></span>
            <p className="tiny" style={{ margin: 0 }}>
              {t('המסלול והתאריכים שלך כבר ממולאים. הסוכן לא מחפש טיסות בעצמו — אין לו נתונים חיים, והוא היה מנחש מחירים.')}
            </p>
          </div>
        </div>
      </div>

      {/* The flight, as entered. Times come from the airline, not from us. */}
      <div className="pad" style={{ marginTop: 14 }}>
        {flight.number ? (
          <div className="card">
            <div className="between" style={{ marginBottom: 12 }}>
              <span className="row" style={{ gap: 9 }}>
                <span className="contact-icon"><Plane size={15} /></span>
                <span className="col" style={{ gap: 2 }}>
                  <strong style={{ fontSize: 15, fontWeight: 600 }} className="ltr">
                    {flight.airline} {flight.number}
                  </strong>
                  <span className="tiny num">{flight.date}</span>
                </span>
              </span>
            </div>

            <a
              className="btn btn-ghost btn-block btn-sm"
              href={`https://www.google.com/search?q=${encodeURIComponent(
                `${flight.airline} ${flight.number} flight status`
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              <Clock size={14} />
              {t('בדוק שעות ומצב טיסה')}
            </a>

            <div className="row" style={{ alignItems: 'flex-start', gap: 9, marginTop: 12 }}>
              <span style={{ color: 'var(--muted)' }}><Info size={14} /></span>
              <p className="tiny" style={{ margin: 0 }}>
                {t('שעות ההמראה והנחיתה מגיעות מחברת התעופה. הסוכן אינו מחובר למאגר טיסות חי — הוא היה מנחש, ולא אתן לו.')}
              </p>
            </div>
          </div>
        ) : (
          <div className="card empty-state">
            <p className="sub" style={{ margin: 0 }}>{t('עוד לא הוספתם פרטי טיסה.')}</p>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => openEdit('flight')}>
              <Plus size={15} /> {t('הוסף פרטי טיסה')}
            </button>
          </div>
        )}
      </div>

      {/* Transfer options */}
      <div className="pad section-head">
        <h2 className="h2" style={{ fontSize: 16 }}>{t('איך מגיעים')}</h2>
      </div>

      <div className="pad">
        <div className="row" style={{ gap: 9 }}>
          <button className="btn btn-primary grow" onClick={ask} disabled={loading || !hasAI}>
            {loading ? <span className="typing"><i /><i /><i /></span> : <Sparkles size={16} />}
            {t('אפשרויות הגעה')}
          </button>
          <button className="btn btn-ghost grow" onClick={askDrivers} disabled={loading || !hasAI}>
            <Car size={16} />
            {t('שירותי הסעות')}
          </button>
        </div>

        {!hasAI && (
          <p className="tiny" style={{ marginTop: 12 }}>{t('דורש חיבור לסוכן ה-AI.')}</p>
        )}
        {error && <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>}

        {options.length > 0 && (
          <div className="col" style={{ gap: 10, marginTop: 18 }}>
            {options.map((o) => (
              <div key={o.mode} className="card">
                <div className="between" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: 14.5, fontWeight: 600 }}>{o.mode}</strong>
                  <span className="hotel-price num">{o.price}</span>
                </div>
                <span className="tiny row" style={{ gap: 6, marginBottom: 7 }}>
                  <Clock size={12} /> {o.duration}
                </span>
                <p className="tiny" style={{ margin: 0 }}>{o.tip}</p>
              </div>
            ))}
          </div>
        )}

        {drivers.length > 0 && (
          <>
            <div className="section-head" style={{ marginBottom: 12 }}>
              <h2 className="h2" style={{ fontSize: 15 }}>{t('שירותי הסעה')}</h2>
            </div>
            <div className="col" style={{ gap: 10 }}>
              {drivers.map((d) => (
                <div key={d.name} className="card">
                  <div className="between" style={{ marginBottom: 6 }}>
                    <span className="col" style={{ gap: 2 }}>
                      <strong style={{ fontSize: 14.5, fontWeight: 600 }}>{d.name}</strong>
                      <span className="tiny">{d.kind}</span>
                    </span>
                    <span className="hotel-price num">{d.price}</span>
                  </div>
                  <p className="tiny" style={{ margin: '0 0 11px' }}>{d.why}</p>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={`https://www.google.com/search?q=${encodeURIComponent(
                      `${d.name} ${trip.city} airport transfer`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation size={14} />
                    {t('חפש פרטים')}
                  </a>
                </div>
              ))}
            </div>
          </>
        )}

        {(options.length > 0 || drivers.length > 0) && (
          <p className="tiny" style={{ marginTop: 14 }}>
            {t('המחירים והזמנים הם הערכות של מודל שפה — בדקו מול הספק לפני שמזמינים.')}
          </p>
        )}
      </div>
    </div>
  )
}
