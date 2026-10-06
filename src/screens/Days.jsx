import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import {
  Sparkles, Plus, ArrowUp, ArrowDown, RefreshCw, Clock, Ticket, MapPin, Users, More, Trash, Calendar,
} from '../components/Icons'
import { CATEGORIES } from '../data'
import BookingSheet from '../components/BookingSheet'
import { useTrip } from '../TripProvider'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { geocode, search } from '../lib/geocode'
import { breadcrumb, watchdog } from '../lib/telemetry'
import { t, tn, locale } from '../i18n'

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
export function dateForDay(trip, day) {
  if (!trip.from) return null
  const [y, m, d] = trip.from.split('-').map(Number)
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d + (day - 1))
  return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

const CAT_FROM_WORD = (w = '') => {
  // Model output, in either language — not UI text.
  if (/מוזיאון|גלריה|museum|galler/i.test(w)) return 'museum' // i18n-ignore
  if (/מסעד|אוכל|קפה|שוק|restaurant|food|caf|market/i.test(w)) return 'food' // i18n-ignore
  if (/הליכ|פארק|גן|שיטוט|walk|park|garden|stroll/i.test(w)) return 'walking' // i18n-ignore
  return 'landmark'
}

/**
 * Everything you can do to one stop, behind one "⋯" button. These used to
 * be four 26px icons on every card (↑ ↓ 🎫 ✕) plus a "move to day" select —
 * below a comfortable tap size, unlabeled, and the ✕ deleted on the spot.
 */
function StopMenu({ stop, index, count, dayList, activeDay, onMove, onMoveToDay, onBook, onRemove }) {
  const [open, setOpen] = useState(false)
  const [daysOpen, setDaysOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!box.current?.contains(e.target)) { setOpen(false); setDaysOpen(false) } }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setDaysOpen(false) } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const act = (fn) => () => { setOpen(false); setDaysOpen(false); fn() }
  const otherDays = dayList.filter((d) => d !== activeDay)

  return (
    <div className="stop-menu" ref={box}>
      <button
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('פעולות על {place}', { place: stop.he })}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
      >
        <More size={20} />
      </button>
      {open && (
        <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <button role="menuitem" disabled={index === 0} onClick={act(() => onMove(-1))}>
            <ArrowUp size={16} /> {t('הזז למעלה')}
          </button>
          <button role="menuitem" disabled={index === count - 1} onClick={act(() => onMove(1))}>
            <ArrowDown size={16} /> {t('הזז למטה')}
          </button>
          {otherDays.length > 0 && (
            <>
              <button role="menuitem" aria-expanded={daysOpen} onClick={() => setDaysOpen((d) => !d)}>
                <Calendar size={16} /> {t('העבר ליום אחר')}
              </button>
              {daysOpen && (
                <div className="menu-days">
                  {otherDays.map((d) => (
                    <button key={d} className="pill" onClick={act(() => onMoveToDay(d))}>
                      {t('יום {n}', { n: d })}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          <button role="menuitem" onClick={act(onBook)}>
            <Ticket size={16} /> {t('הזמנת מקום או כרטיסים')}
          </button>
          <button role="menuitem" className="danger" onClick={act(onRemove)}>
            <Trash size={16} /> {t('הסר מהמסלול')}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * `embedded` — rendered inside the desktop route split, under its shared
 * top bar; `focusId`/`onFocusStop` keep the list and the map pointing at
 * the same stop there. `switcher` is the phone's "map" pill. `addSignal`
 * changing scrolls to (and focuses) the add-a-stop form.
 */
export default function Days({ embedded = false, focusId = null, onFocusStop, addSignal = 0, switcher = null }) {
  const {
    trip, days, activeDay, setActiveDay, stops,
    families, activeFamily, switchFamily, toggleSharedDay,
    planning, planWarning, plan, moveStop, addStop, removeStop, updateStop,
    moveStopToDay, planDays, planQueue, planningDay,
  } = useTrip()

  // A removed stop, kept for a few seconds so the removal can be undone.
  const [undo, setUndo] = useState(null)
  const undoTimer = useRef(null)
  useEffect(() => () => clearTimeout(undoTimer.current), [])

  const addRef = useRef(null)
  const addInput = useRef(null)
  useEffect(() => {
    if (!addSignal) return
    addRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => addInput.current?.focus({ preventScroll: true }), 400)
    return () => clearTimeout(timer)
  }, [addSignal])

  // A pin tapped on the map beside the list brings its stop into view.
  useEffect(() => {
    if (!focusId || !embedded) return
    document.querySelector(`[data-stop-row="${focusId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusId, embedded])

  /**
   * Finds a place from what someone typed. The geocoder barely understands
   * Hebrew, and "טירת קרלשטיין, פראג" (a Hebrew name plus a Hebrew city, for
   * a castle that isn't even in Prague) matched nothing — the stop went in
   * with no position and never reached the map. So: the English city name
   * first, then the bare name, then — for a Hebrew name — ask the model only
   * for the place's local name (never coordinates; those still come from the
   * geocoder) and search that.
   */
  const findPlaces = async (name, { ai = false } = {}) => {
    const cityEn = trip.cityEn ?? trip.city
    for (const q of [`${name}, ${cityEn}`, `${name}, ${trip.country}`, name]) {
      const hits = await search(q, 5)
      if (hits.length > 0) return hits
    }
    if (ai && hasAI && /[֐-׿]/.test(name)) { // i18n-ignore — detects a Hebrew place name
      try {
        const local = (await complete({
          kind: 'lookup',
          system:
            'החזר אך ורק את שם המקום בשפה המקומית או באנגלית כפי שהוא מופיע ב-OpenStreetMap. ' + // i18n-ignore — AI prompt
            'שורה אחת, בלי הסברים, בלי מירכאות.', // i18n-ignore
          prompt: `${name} — ליד ${trip.city}, ${trip.country}`, // i18n-ignore
        })).split('\n')[0].trim()
        if (local) {
          for (const q of [`${local}, ${trip.country}`, local]) {
            const hits = await search(q, 5)
            if (hits.length > 0) return hits
          }
        }
      } catch { /* falls through to "not found" */ }
    }
    return []
  }

  const [locatingId, setLocatingId] = useState(null)
  const locateStop = async (s) => {
    setLocatingId(s.id)
    const [hit] = await findPlaces(s.he ?? s.name, { ai: true })
    setLocatingId(null)
    if (hit) {
      updateStop(activeDay, s.id, { lat: hit.lat, lng: hit.lng, desc: s.desc || hit.label })
    } else {
      setError(t('עדיין לא הצלחתי לאתר את "{name}". אפשר לכתוב את שמו באנגלית או בשפת המקום.', { name: s.he ?? s.name }))
    }
  }

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

  const activeFamilyObj = families.find((f) => f.id === activeFamily)
  const rangeStart = activeFamilyObj?.arriveDay ?? 1
  const rangeEnd = activeFamilyObj?.departDay ?? trip.totalDays
  const dayList = Array.from({ length: Math.max(0, rangeEnd - rangeStart + 1) }, (_, i) => rangeStart + i)
  const isSharedDay = (activeFamilyObj?.sharedDays ?? []).includes(activeDay)
  const queued = planQueue.includes(activeDay)
  const emptyDays = dayList.filter((d) => !(days[d]?.length) && !planQueue.includes(d))

  /** Asks for stops that are not already in the day, so repeats are unlikely. */
  const suggest = async () => {
    if (asking || !hasAI) return
    breadcrumb('action', `suggest stops for day ${activeDay}`)
    setAsking(true)
    setError(null)
    const done = watchdog('days.suggest', 30000, { day: activeDay })

    try {
      const already = stops.map((s) => s.name).join(', ') || 'אין עדיין' // i18n-ignore — AI prompt
      const text = await complete({
        kind: 'suggest',
        system:
          'אתה מתכנן מסלולי טיול. החזר אך ורק שורות בפורמט:\n' + // i18n-ignore — AI prompt; see gemini.js language override
          'שעה | כתובת מלאה באנגלית בפורמט "Place, City, Country" | שם בעברית | קטגוריה | תיאור קצר\n' + // i18n-ignore
          'קטגוריה היא אחת מ: מוזיאון, מסעדה, הליכה, אתר.\n' + // i18n-ignore
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות.', // i18n-ignore
        prompt:
          `עיר: ${trip.city}${trip.country ? `, ${trip.country}` : ''}\n` + // i18n-ignore
          `יום ${activeDay} מתוך ${trip.totalDays}\n` + // i18n-ignore
          `כבר במסלול היום: ${already}\n\n` + // i18n-ignore
          'הצע 4 עצירות נוספות שאינן ברשימה, עם שעות שמשתלבות בין הקיימות.', // i18n-ignore
      })

      const rows = parseRows(text, ['time', 'name', 'he', 'category', 'desc'])
      if (rows.length === 0) setError(t('לא הצלחתי לפענח את ההצעות. נסה שוב.'))
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
      const hits = await findPlaces(text)
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
      hit = (await findPlaces(name, { ai: true }))[0] ?? null
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
    })

    if (!hit) setError(t('"{name}" נוסף ללו"ז אבל לא אותר על המפה.', { name }))
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
      setError(t('לא הצלחתי לאתר את "{name}" על המפה.', { name: row.name.split(',')[0] }))
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
    })
    setSuggestions((s) => s.filter((x) => x.name !== row.name))
  }

  const remove = (s) => {
    removeStop(activeDay, s.id)
    setUndo({ stop: s, day: activeDay })
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndo(null), 6000)
  }

  const restore = () => {
    if (!undo) return
    // eslint-disable-next-line no-unused-vars
    const { id, ...rest } = undo.stop
    addStop(undo.day, rest)
    clearTimeout(undoTimer.current)
    setUndo(null)
  }

  return (
    <div className={`screen ${switcher ? 'has-switch' : ''}`}>
      {!embedded && <TopBar />}

      <div className="pad">
        <h1 className="h1" style={{ fontSize: 24 }}>{t('מסלול הטיול')}</h1>
        <p className="tiny" style={{ marginTop: 4 }}>
          {trip.city} · <span className="num">{trip.totalDays}</span> {tn(trip.totalDays, 'יום אחד', 'ימים')}
        </p>
      </div>

      {/* Each family plans its own days — this switches whose plan is showing,
          not a filter over one shared plan. Hidden for a solo family since
          there is nothing to switch between. */}
      {families.length > 1 && (
        <div className="hscroll chips" style={{ marginTop: 14 }}>
          {families.map((f) => (
            <button
              key={f.id}
              className={`pill ${activeFamily === f.id ? 'on' : ''}`}
              onClick={() => switchFamily(f.id)}
            >
              <i className="dot" style={{ background: f.color, marginInlineEnd: 6 }} />
              {f.name}
            </button>
          ))}
        </div>
      )}

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
                {t('יום')} {d}
                <span className="tiny">
                  {date
                    ? <>{date}{count > 0 && <> · <span className="num">{count}</span> {tn(count, 'עצירה', 'עצירות')}</>}{count === 0 && planQueue.includes(d) && <> · {t('בבנייה…')}</>}</>
                    : count > 0 ? <><span className="num">{count}</span> {tn(count, 'עצירה', 'עצירות')}</> : planQueue.includes(d) ? t('בבנייה…') : t('ריק')}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {!planning && emptyDays.length > 1 && (
        <div className="pad" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm btn-block" onClick={() => planDays(emptyDays)}>
            <Sparkles size={15} />
            {t('בנה את כל הימים הריקים ({n})', { n: emptyDays.length })}
          </button>
        </div>
      )}

      <div className="pad section-head">
        <span className="col" style={{ gap: 2 }}>
          <h2 className="h2" style={{ fontSize: 16 }}>{t('יום')} {activeDay}</h2>
          {dateForDay(trip, activeDay) && (
            <span className="tiny">{dateForDay(trip, activeDay)}</span>
          )}
        </span>
        <span className="row" style={{ gap: 8 }}>
          {/* Any family that marks the same day "together" lands on the
              identical shared plan — nobody is "hosting" it. */}
          {families.length > 1 && (
            <button
              className={`pill ${isSharedDay ? 'on' : ''}`}
              style={{ padding: '6px 12px' }}
              onClick={() => toggleSharedDay(activeDay)}
              aria-pressed={isSharedDay}
              title={isSharedDay ? t('היום הזה מתוכנן יחד עם כל מי שהצטרף אליו') : t('תכנן את היום הזה יחד עם משפחות אחרות')}
            >
              <Users size={13} style={{ marginInlineEnd: 5 }} />
              {t('יחד')}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => plan(activeDay)}
            disabled={planning}
            title={t('בנה את היום מחדש')}
          >
            <RefreshCw size={14} />
            {t('בנה מחדש')}
          </button>
        </span>
      </div>

      {planWarning && (
        <div className="pad"><p className="tiny" style={{ color: 'var(--amber)' }}>{planWarning}</p></div>
      )}

      <div className="pad">
        {queued && stops.length === 0 && (
          <div className="col" style={{ gap: 10 }}>
            <p className="tiny" role="status">
              {planningDay === activeDay
                ? t('הסוכן בונה את היום...')
                : t('בתור — הסוכן בונה עכשיו את יום {n}, ואחר כך יגיע ליום הזה.', { n: planningDay })}
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="card skeleton-card" aria-hidden="true">
                <span className="skeleton" style={{ width: 90, height: 12 }} />
                <span className="skeleton" style={{ width: '55%', height: 16, marginTop: 10 }} />
                <span className="skeleton" style={{ width: '90%', height: 10, marginTop: 10 }} />
              </div>
            ))}
          </div>
        )}

        {!queued && stops.length === 0 && (
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="sub" style={{ marginBottom: 14 }}>{t('היום הזה עדיין ריק.')}</p>
            <button className="btn btn-primary btn-sm" onClick={() => plan(activeDay)} disabled={planning}>
              <Sparkles size={15} />
              {t('בנה לי יום')}
            </button>
          </div>
        )}

        {/* The itinerary itself */}
        <ol className="stop-list">
          {stops.map((s, i) => (
            <li
              key={s.id}
              data-stop-row={s.id}
              className={`stop-item ${focusId === s.id ? 'focused' : ''}`}
              onClick={() => onFocusStop?.(s.id)}
            >
              <span className="stop-rail" aria-hidden="true">
                <i className="stop-bead" style={{ background: CATEGORIES[s.cat]?.color }} />
                {i < stops.length - 1 && <i className="stop-line" />}
              </span>

              <div className="stop-body">
                <div className="between">
                  <span className="row" style={{ gap: 7 }}>
                    <Clock size={13} />
                    <strong className="num" style={{ fontSize: 13 }}>{s.time}</strong>
                    <span className="badge" style={{ padding: '2px 8px', fontSize: 10.5 }}>
                      {CATEGORIES[s.cat]?.label}
                    </span>
                  </span>

                  <StopMenu
                    stop={s}
                    index={i}
                    count={stops.length}
                    dayList={dayList}
                    activeDay={activeDay}
                    onMove={(delta) => moveStop(activeDay, s.id, delta)}
                    onMoveToDay={(d) => moveStopToDay(activeDay, s.id, d)}
                    onBook={() => setBooking(s)}
                    onRemove={() => remove(s)}
                  />
                </div>

                <h3 className="h3" style={{ marginTop: 4 }}>{s.he}</h3>
                <p className="tiny" style={{ margin: '4px 0 0' }}>{s.desc}</p>

                {s.lat == null && (
                  <button
                    className="text-btn"
                    style={{ color: 'var(--amber)', marginTop: 8 }}
                    onClick={(e) => { e.stopPropagation(); locateStop(s) }}
                    disabled={locatingId === s.id}
                  >
                    <MapPin size={13} />
                    {locatingId === s.id ? t('מאתר…') : t('לא על המפה — אתר')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>

        {/* Add manually */}
        <div className="section-head" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ fontSize: 15 }}>{t('הוסף יעד בעצמך')}</h2>
        </div>

        <div className="card" style={{ marginBottom: 20 }} ref={addRef}>
          <div className="autocomplete">
            <div className="row field-row">
              <MapPin size={17} />
              <input
                ref={addInput}
                className="field-bare"
                value={manualName}
                onChange={(e) => { setManualName(e.target.value); lookupPlace(e.target.value) }}
                placeholder={t('שם המקום')}
                aria-label={t('שם היעד')}
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
              <span className="label">{t('שעה')}</span>
              <input
                type="time"
                className="field"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
              />
            </label>
            <label className="grow">
              <span className="label">{t('קטגוריה')}</span>
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
              {t('נמצא:')} <span className="num">{picked.lat.toFixed(4)}, {picked.lng.toFixed(4)}</span>
            </p>
          )}

          <button
            className="btn btn-primary btn-block btn-sm"
            style={{ marginTop: 12 }}
            onClick={addManual}
            disabled={!manualName.trim() || locating}
          >
            {locating ? <span className="typing"><i /><i /><i /></span> : <Plus size={15} />}
            {t('הוסף ליום {day}', { day: activeDay })}
          </button>

          <p className="tiny" style={{ marginTop: 10 }}>
            {t('בחירה מהרשימה מצמידה מיקום מדויק. אפשר גם להקליד שם חופשי — נחפש אותו לפני ההוספה, ואם לא יימצא הוא לא ייכנס למפה.')}
          </p>
        </div>

        {/* Add from the agent */}
        <div className="section-head" style={{ marginBottom: 12 }}>
          <h2 className="h2" style={{ fontSize: 15 }}>{t('או שהסוכן יציע')}</h2>
        </div>

        {hasAI ? (
          <button className="btn btn-ghost btn-block" onClick={suggest} disabled={asking}>
            {asking ? (
              <><span className="typing"><i /><i /><i /></span> {t('מחפש רעיונות...')}</>
            ) : (
              <><Sparkles size={16} /> {t('הצע לי עצירות ליום {day}', { day: activeDay })}</>
            )}
          </button>
        ) : (
          <p className="tiny">{t('הצעות דורשות חיבור לסוכן ה-AI.')}</p>
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
              {t('עצירה נוספת מאותרת על המפה לפני שהיא נכנסת למסלול — אם לא נמצא מיקום, היא לא תתווסף.')}
            </p>
          </div>
        )}

      </div>

      <BookingSheet
        open={Boolean(booking)}
        place={booking}
        kind={booking?.cat === 'food' ? 'food' : 'attraction'}
        onClose={() => setBooking(null)}
      />

      {undo && (
        <div className="undo-toast" role="status">
          <span>{t('"{place}" הוסר מהמסלול', { place: undo.stop.he ?? undo.stop.name })}</span>
          <button onClick={restore}>{t('בטל')}</button>
        </div>
      )}

      {switcher && <div className="view-switch-wrap">{switcher}</div>}
    </div>
  )
}
