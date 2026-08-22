import { useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import {
  Sparkles, Plus, X, ArrowUp, ArrowDown, RefreshCw, Clock, Ticket, Phone, MapPin,
} from '../components/Icons'
import { CATEGORIES } from '../data'
import BookingSheet from '../components/BookingSheet'
import { useTrip } from '../TripProvider'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { geocode, search } from '../lib/geocode'
import { breadcrumb, watchdog } from '../lib/telemetry'

/**
 * The calendar date and weekday for one day of the trip, in Hebrew — "יום
 * שלישי, 15 בספטמבר" — or null if no dates were given in onboarding.
 *
 * `trip.from` is a plain "YYYY-MM-DD" from a date input. Parsed through
 * `new Date(string)` that reads as UTC midnight, and formatting it for a
 * viewer west of Greenwich rolls it back to the previous local day — so it
 * is built from the parts instead, as a local-midnight date, which is
 * immune to the viewer's own timezone.
 */
function dateForDay(trip, day) {
  if (!trip.from) return null
  const [y, m, d] = trip.from.split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d + (day - 1))
  return date.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
}

const CAT_FROM_WORD = (w = '') => {
  if (/מוזיאון|גלריה/.test(w)) return 'museum'
  if (/מסעד|אוכל|קפה|שוק/.test(w)) return 'food'
  if (/הליכ|פארק|גן|שיטוט/.test(w)) return 'walking'
  return 'landmark'
}

export default function Days() {
  const {
    trip, days, activeDay, setActiveDay, stops,
    planning, planWarning, plan, moveStop, addStop, removeStop,
    reservations, removeReservation, moveStopToDay,
  } = useTrip()

  const [suggestions, setSuggestions] = useState([])
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(null)
  const [booking, setBooking] = useState(null)

  /* ---- manual stop entry ---- */
  const [manualName, setManualName] = useState('')
  const [manualTime, setManualTime] = useState('10:00')
  const [manualCat, setManualCat] = useState('landmark')
  const [placeHits, setPlaceHits] = useState([])
  const [placeLoading, setPlaceLoading] = useState(false)
  const [picked, setPicked] = useState(null)
  const [locating, setLocating] = useState(false)
  const placeTimer = useRef(null)

  if (!trip) return null

  const dayList = Array.from({ length: trip.totalDays }, (_, i) => i + 1)

  /** Asks for stops that are not already in the day, so repeats are unlikely. */
  const suggest = async () => {
    if (asking || !hasAI) return
    breadcrumb('action', `suggest stops for day ${activeDay}`)
    setAsking(true)
    setError(null)
    const done = watchdog('days.suggest', 30000, { day: activeDay })

    try {
      const already = stops.map((s) => s.name).join(', ') || 'אין עדיין'
      const text = await complete({
        system:
          'אתה מתכנן מסלולי טיול. החזר אך ורק שורות בפורמט:\n' +
          'שעה | כתובת מלאה באנגלית בפורמט "Place, City, Country" | שם בעברית | קטגוריה | תיאור קצר\n' +
          'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר.\n' +
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות.',
        prompt:
          `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` +
          `יום ${activeDay} מתוך ${trip.totalDays}\n` +
          `כבר במסלול היום: ${already}\n\n` +
          'הצע 4 עצירות נוספות שאינן ברשימה, עם שעות שמשתלבות בין הקיימות.',
      })

      const rows = parseRows(text, ['time', 'name', 'he', 'category', 'desc'])
      if (rows.length === 0) setError('לא הצלחתי לפענח את ההצעות. נסה שוב.')
      setSuggestions(rows)
    } catch (err) {
      setError(err.message)
    } finally {
      done()
      setAsking(false)
    }
  }

  /** Debounced place lookup, scoped to the destination city. */
  const lookupPlace = (text) => {
    clearTimeout(placeTimer.current)
    setPicked(null)

    if (text.trim().length < 3) {
      setPlaceHits([])
      setPlaceLoading(false)
      return
    }

    setPlaceLoading(true)
    placeTimer.current = setTimeout(async () => {
      const hits = await search(`${text}, ${trip.city}`, 5)
      setPlaceHits(hits)
      setPlaceLoading(false)
    }, 500)
  }

  /**
   * Adds whatever the user typed. A suggestion already carries coordinates;
   * free text gets geocoded first, and goes in without a position rather than
   * being rejected — a stop with a time and a name is still useful, it just
   * will not appear on the map.
   */
  const addManual = async () => {
    const name = manualName.trim()
    if (!name) return

    let hit = picked
    if (!hit) {
      setLocating(true)
      hit = await search(`${name}, ${trip.city}`, 1).then((r) => r[0] ?? null)
      setLocating(false)
    }

    addStop(activeDay, {
      name: hit?.name ?? name,
      he: name,
      desc: hit?.label ?? '',
      time: manualTime,
      cat: manualCat,
      rating: null,
      lat: hit?.lat ?? null,
      lng: hit?.lng ?? null,
      who: [],
    })

    if (!hit) setError(`"${name}" נוסף ללו"ז אבל לא אותר על המפה.`)
    setManualName('')
    setPicked(null)
    setPlaceHits([])
  }

  /** A suggestion only joins the day once it has a real position. */
  const accept = async (row) => {
    setAdding(row.name)
    const hit = await geocode(row.name)
    setAdding(null)

    if (!hit) {
      setError(`לא הצלחתי לאתר את "${row.name.split(',')[0]}" על המפה.`)
      return
    }

    addStop(activeDay, {
      name: row.name.split(',')[0].trim(),
      he: row.he || row.name,
      desc: row.desc,
      time: row.time,
      cat: CAT_FROM_WORD(row.category),
      rating: null,
      lat: hit.lat,
      lng: hit.lng,
      who: [],
    })
    setSuggestions((s) => s.filter((x) => x.name !== row.name))
  }

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <h1 className="h1" style={{ fontSize: 24 }}>מסלול הטיול</h1>
        <p className="tiny" style={{ marginTop: 4 }}>
          {trip.city} · <span className="num">{trip.totalDays}</span> ימים
        </p>
      </div>

      {/* Day selector */}
      <div className="hscroll chips" style={{ marginTop: 18 }}>
        {dayList.map((d) => {
          const count = days[d]?.length ?? 0
          const date = dateForDay(trip, d)
          return (
            <button
              key={d}
              className={`day-chip ${d === activeDay ? 'on' : ''}`}
              onClick={() => { setActiveDay(d); setSuggestions([]); setError(null) }}
            >
              <span className="day-chip-num num">{d}</span>
              <span className="day-chip-label">
                יום {d}
                <span className="tiny">
                  {date
                    ? <>{date}{count > 0 && <> · <span className="num">{count}</span> עצירות</>}</>
                    : count > 0 ? <><span className="num">{count}</span> עצירות</> : 'ריק'}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="pad section-head">
        <span className="col" style={{ gap: 2 }}>
          <h2 className="h2" style={{ fontSize: 16 }}>יום {activeDay}</h2>
          {dateForDay(trip, activeDay) && (
            <span className="tiny">{dateForDay(trip, activeDay)}</span>
          )}
        </span>
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          onClick={() => plan(activeDay)}
          disabled={planning}
          aria-label="בנה את היום מחדש"
          title="בנה את היום מחדש"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {planWarning && (
        <div className="pad"><p className="tiny" style={{ color: 'var(--amber)' }}>{planWarning}</p></div>
      )}

      <div className="pad">
        {planning && stops.length === 0 && (
          <div className="card" style={{ textAlign: 'center' }}>
            <span className="typing"><i /><i /><i /></span>
            <p className="tiny" style={{ marginTop: 10 }}>הסוכן בונה את היום...</p>
          </div>
        )}

        {!planning && stops.length === 0 && (
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="sub" style={{ marginBottom: 14 }}>היום הזה עדיין ריק.</p>
            <button className="btn btn-primary btn-sm" onClick={() => plan(activeDay)}>
              <Sparkles size={15} />
              בנה לי יום
            </button>
          </div>
        )}

        {/* The itinerary itself */}
        <ol className="stop-list">
          {stops.map((s, i) => (
            <li key={s.id} className="stop-item">
              <span className="stop-rail" aria-hidden="true">
                <i className="stop-bead" style={{ background: CATEGORIES[s.cat]?.color }} />
                {i < stops.length - 1 && <i className="stop-line" />}
              </span>

              <div className="stop-body">
                <div className="between">
                  <span className="row" style={{ gap: 7 }}>
                    <Clock size={13} />
                    <strong className="num" style={{ fontSize: 13 }}>{s.time}</strong>
                    <span className="badge" style={{ padding: '2px 8px', fontSize: 10 }}>
                      {CATEGORIES[s.cat]?.label}
                    </span>
                  </span>

                  <span className="row" style={{ gap: 2 }}>
                    <button
                      className="icon-btn" style={{ width: 26, height: 26 }}
                      onClick={() => moveStop(activeDay, s.id, -1)}
                      disabled={i === 0}
                      aria-label="הזז למעלה"
                    ><ArrowUp size={13} /></button>
                    <button
                      className="icon-btn" style={{ width: 26, height: 26 }}
                      onClick={() => moveStop(activeDay, s.id, 1)}
                      disabled={i === stops.length - 1}
                      aria-label="הזז למטה"
                    ><ArrowDown size={13} /></button>
                    <button
                      className="icon-btn" style={{ width: 26, height: 26 }}
                      onClick={() => setBooking(s)}
                      aria-label={`הזמן מקום ב${s.he}`}
                      title="הזמנת מקום או כרטיסים"
                    ><Ticket size={13} /></button>
                    <button
                      className="icon-btn" style={{ width: 26, height: 26 }}
                      onClick={() => removeStop(activeDay, s.id)}
                      aria-label={`הסר את ${s.he}`}
                    ><X size={13} /></button>
                  </span>
                </div>

                <h3 className="h3" style={{ marginTop: 6 }}>{s.he}</h3>
                <p className="tiny" style={{ margin: '4px 0 8px' }}>{s.desc}</p>

                <div className="row" style={{ gap: 8 }}>
                  {s.lat == null && (
                    <span className="tiny" style={{ color: 'var(--amber)' }}>לא על המפה</span>
                  )}
                  {trip.totalDays > 1 && (
                    <label className="row" style={{ gap: 6, marginInlineStart: 'auto' }}>
                      <span className="tiny">העבר ליום</span>
                      <select
                        className="day-move"
                        value={activeDay}
                        onChange={(e) => moveStopToDay(activeDay, s.id, Number(e.target.value))}
                        aria-label={`העבר את ${s.he} ליום אחר`}
                      >
                        {dayList.map((d) => (
                          <option key={d} value={d}>
                            {d === activeDay ? `יום ${d} (כאן)` : `יום ${d}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {/* Add manually */}
        <div className="section-head" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ fontSize: 15 }}>הוסף יעד בעצמך</h2>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="autocomplete">
            <div className="row field-row">
              <MapPin size={17} />
              <input
                className="field-bare"
                value={manualName}
                onChange={(e) => { setManualName(e.target.value); lookupPlace(e.target.value) }}
                placeholder="שם המקום"
                aria-label="שם היעד"
                autoComplete="off"
              />
              {placeLoading && <span className="typing"><i /><i /><i /></span>}
            </div>

            {placeHits.length > 0 && (
              <ul className="suggestions" role="listbox">
                {placeHits.map((h) => (
                  <li key={`${h.lat},${h.lng}`}>
                    <button onClick={() => { setPicked(h); setManualName(h.name); setPlaceHits([]) }}>
                      <MapPin size={14} />
                      <span className="grow">
                        <strong>{h.name}</strong>
                        <span className="tiny stay-address">{h.label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="row" style={{ gap: 10, marginTop: 11 }}>
            <label style={{ flex: '0 0 108px' }}>
              <span className="label">שעה</span>
              <input
                type="time"
                className="field"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
              />
            </label>
            <label className="grow">
              <span className="label">קטגוריה</span>
              <select
                className="field"
                value={manualCat}
                onChange={(e) => setManualCat(e.target.value)}
              >
                {Object.entries(CATEGORIES).map(([id, c]) => (
                  <option key={id} value={id}>{c.label}</option>
                ))}
              </select>
            </label>
          </div>

          {picked && (
            <p className="tiny" style={{ marginTop: 10 }}>
              נמצא: <span className="num">{picked.lat.toFixed(4)}, {picked.lng.toFixed(4)}</span>
            </p>
          )}

          <button
            className="btn btn-primary btn-block btn-sm"
            style={{ marginTop: 12 }}
            onClick={addManual}
            disabled={!manualName.trim() || locating}
          >
            {locating ? <span className="typing"><i /><i /><i /></span> : <Plus size={15} />}
            הוסף ליום {activeDay}
          </button>

          <p className="tiny" style={{ marginTop: 10 }}>
            בחירה מהרשימה מצמידה מיקום מדויק. אפשר גם להקליד שם חופשי — נחפש אותו
            לפני ההוספה, ואם לא יימצא הוא לא ייכנס למפה.
          </p>
        </div>

        {/* Add from the agent */}
        <div className="section-head" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ fontSize: 15 }}>או שהסוכן יציע</h2>
        </div>

        {hasAI ? (
          <button className="btn btn-ghost btn-block" onClick={suggest} disabled={asking}>
            {asking ? (
              <><span className="typing"><i /><i /><i /></span> מחפש רעיונות...</>
            ) : (
              <><Sparkles size={16} /> הצע לי עצירות ליום {activeDay}</>
            )}
          </button>
        ) : (
          <p className="tiny">הצעות דורשות חיבור לסוכן ה-AI.</p>
        )}

        {error && <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>}

        {suggestions.length > 0 && (
          <div className="col" style={{ gap: 9, marginTop: 14 }}>
            {suggestions.map((row) => (
              <button
                key={row.name}
                className="choice"
                style={{ padding: 13 }}
                onClick={() => accept(row)}
                disabled={adding === row.name}
              >
                <span className="between" style={{ alignItems: 'flex-start' }}>
                  <span className="grow" style={{ textAlign: 'start', minWidth: 0 }}>
                    <span className="row" style={{ gap: 7, marginBottom: 4 }}>
                      <strong className="num" style={{ fontSize: 12.5 }}>{row.time}</strong>
                      <span className="tiny">{row.category}</span>
                    </span>
                    <span className="choice-title" style={{ marginTop: 0 }}>{row.he}</span>
                    <span className="choice-sub">{row.desc}</span>
                  </span>
                  {adding === row.name
                    ? <span className="typing"><i /><i /><i /></span>
                    : <Plus size={16} />}
                </span>
              </button>
            ))}
            <p className="tiny">
              עצירה נוספת מאותרת על המפה לפני שהיא נכנסת למסלול — אם לא נמצא מיקום, היא לא תתווסף.
            </p>
          </div>
        )}

        {/* Reservations kept for this trip */}
        {reservations.length > 0 && (
          <>
            <div className="section-head" style={{ marginBottom: 12 }}>
              <h2 className="h2" style={{ fontSize: 15 }}>
                ההזמנות שלך (<span className="num">{reservations.length}</span>)
              </h2>
            </div>
            <div className="col" style={{ gap: 9 }}>
              {reservations.map((r) => (
                <div key={r.id} className="reservation">
                  <span className="reservation-when">
                    <strong className="num">{r.time}</strong>
                    <span className="tiny num">{r.date?.slice(5)}</span>
                  </span>
                  <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{r.place}</strong>
                    <span className="tiny">
                      <span className="num">{r.party}</span> {r.kind === 'food' ? 'סועדים' : 'משתתפים'}
                      {r.phone ? ' · יש טלפון' : ''}
                    </span>
                  </span>
                  {r.phone && (
                    <a
                      className="icon-btn" style={{ width: 30, height: 30 }}
                      href={`tel:${r.phone.replace(/\s/g, '')}`}
                      aria-label={`התקשר ל${r.place}`}
                    ><Phone size={14} /></a>
                  )}
                  <button
                    className="icon-btn" style={{ width: 30, height: 30 }}
                    onClick={() => removeReservation(r.id)}
                    aria-label={`בטל את ההזמנה ב${r.place}`}
                  ><X size={13} /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <BookingSheet
        open={Boolean(booking)}
        place={booking}
        kind={booking?.cat === 'food' ? 'food' : 'attraction'}
        onClose={() => setBooking(null)}
      />
    </div>
  )
}
