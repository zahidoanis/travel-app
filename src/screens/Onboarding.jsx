import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Mic, Bot, Plus, X, Users, MapPin, Calendar,
  Bed, Sparkles, Info, Navigation,
} from '../components/Icons'
import { TRAVEL_STYLES, DESTINATIONS, PARTY_COLORS, CUISINES, memberAge, TIME_OPTIONS } from '../data'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { search, geocode } from '../lib/geocode'
import { CITIES, searchCities } from '../cities'
import { breadcrumb, watchdog } from '../lib/telemetry'
import DateRangeCalendar from '../components/DateRangeCalendar'
import MapImportSheet from '../components/MapImportSheet'
import { t, tn } from '../i18n'
import { lang } from '../i18n'

/**
 * One question per screen. Each step declares its own validity, so the CTA
 * enables itself rather than every step re-implementing the same check.
 */
const STEPS = [
  {
    id: 'where',
    title: t('לאן נוסעים?'),
    sub: t('בחר יעד מהרשימה או הקלד יעד משלך.'),
    valid: (a) => a.destination.trim().length > 1,
    blocker: () => t('בחר או הקלד יעד כדי להמשיך.'),
  },
  {
    id: 'when',
    title: t('מתי?'),
    sub: t('טווח התאריכים קובע את חלוקת הימים במסלול.'),
    valid: (a) => Boolean(a.from && a.to && a.to > a.from),
    blocker: (a) =>
      !a.from ? t('בחר תאריך יציאה.')
        : !a.to ? t('בחר תאריך חזרה.')
        : t('תאריך החזרה חייב להיות אחרי היציאה.'),
  },
  {
    id: 'style',
    title: t('מה אופי הטיול?'),
    sub: t('אפשר לבחור כמה. זה משפיע על סוג העצירות שנציע.'),
    valid: (a) => a.styles.length > 0,
    blocker: () => t('בחר לפחות סגנון אחד.'),
  },
  {
    id: 'who',
    title: t('מי מטייל?'),
    sub: t('כמה אתם — ואם נוסעות כמה משפחות יחד, כל אחת תקבל לו"ז והוצאות משלה.'),
    valid: (a) =>
      a.parties.length > 0 &&
      a.parties.every((p) => (a.parties.length === 1 || p.name.trim()) && p.members.length > 0),
    blocker: (a) => {
      // A name only matters once there is more than one family to tell apart.
      if (a.parties.length > 1) {
        const i = a.parties.findIndex((p) => !p.name.trim())
        if (i >= 0) return t('למשפחה {n} חסר שם.', { n: i + 1 })
      }
      const j = a.parties.findIndex((p) => p.members.length === 0)
      if (j >= 0) return t('חסר לפחות נוסע אחד.')
      return t('מלא את פרטי המשפחות.')
    },
  },
  {
    id: 'food',
    title: t('מה אוהבים לאכול?'),
    sub: t('ההעדפות האלה מסננות את המלצות המסעדות לאורך כל הטיול.'),
    valid: (a) => a.cuisines.length > 0,
    blocker: () => t('בחר לפחות סוג מטבח אחד.'),
  },
  {
    id: 'flight',
    title: t('איך מגיעים?'),
    sub: t('מספר טיסה וחברת תעופה — כדי שנוכל לתכנן את ההגעה למלון.'),
    valid: () => true,
  },
  {
    id: 'stay',
    title: t('איפה תישנו?'),
    sub: t('אם כבר הזמנתם — נאתר את המלון על המפה. אם לא, הסוכן ימצא לכם.'),
    // Optional — a trip is plannable without a hotel picked yet.
    valid: () => true,
  },
]

/**
 * A first-time trip asks only what the itinerary needs — where, when, the
 * kind of trip, who — and gets to the plan. Food, flight and the hotel
 * used to be steps 5-7 before anything appeared; they're now offered on
 * Home afterwards ("השלימו את הטיול"), each opening this same wizard on
 * its own step. Editing an existing trip still walks all seven.
 */
const FIRST_RUN = ['where', 'when', 'style', 'who']

const today = new Date().toISOString().slice(0, 10)

/**
 * `initial` + `startAt` + `editMode` turn the same wizard into an editor for
 * an existing trip: seeded with its current answers instead of blank ones,
 * opened on whichever question the caller wants rather than always "where",
 * and free to leave from step 0 instead of being stuck there. `onDone` still
 * receives the full answers either way — what happens with them (create a
 * trip vs. save changes to one) is entirely the caller's decision, not
 * something this component needs to know about.
 */
export default function Onboarding({ onDone, initial, startAt, editMode = false, onClose }) {
  const [step, setStep] = useState(() => {
    if (!startAt) return 0
    const i = (editMode ? STEPS : STEPS.filter((s) => FIRST_RUN.includes(s.id))).findIndex((s) => s.id === startAt)
    return i >= 0 ? i : 0
  })

  const [answers, setAnswers] = useState({
    destination: '',
    country: '',
    from: '',
    to: '',
    departTime: '',
    returnTime: '',
    styles: [],
    parties: [{ id: 'p1', name: '', members: [{ name: '', age: '' }], color: PARTY_COLORS[0] }],
    cuisines: ['local'],
    flight: { airline: '', number: '', arrivalAirport: '', date: '' },
    stays: [],
    ...initial,
  })

  /* ---- destination autocomplete ---- */
  const [cityHits, setCityHits] = useState([])
  const [cityLoading, setCityLoading] = useState(false)
  const cityTimer = useRef(null)

  /**
   * The curated list answers instantly and matches prefixes, which is what
   * autocomplete needs. Nominatim only gets asked when nothing local matches,
   * so obscure destinations still work without slowing down the common case.
   */
  const lookupCity = (text) => {
    clearTimeout(cityTimer.current)
    const q = text.trim()

    if (q.length < 1) {
      setCityHits([])
      setCityLoading(false)
      return
    }

    const local = searchCities(q, 6)
    // Each curated city carries both names; show (and store) the one in the
    // UI's language, keeping the English one for searches either way.
    setCityHits(local.map((c) => ({
      ...c,
      name: lang === 'en' ? c.en : c.he,
      country: lang === 'en' ? c.countryEn : c.country,
      source: 'local',
    })))

    if (local.length > 0 || q.length < 3) {
      setCityLoading(false)
      return
    }

    setCityLoading(true)
    cityTimer.current = setTimeout(async () => {
      const hits = await search(q, 5, 'city')
      setCityHits(hits.map((h) => ({ ...h, source: 'remote' })))
      setCityLoading(false)
    }, 500)
  }

  /* ---- hotel ---- */
  // Defaults to the search flow. Starting at null left the screen showing a
  // title and two buttons with nothing under them, which reads as broken.
  const [booked, setBooked] = useState('no')   // null | 'yes' | 'no'
  const [query, setQuery] = useState('')
  const [hotels, setHotels] = useState([])
  const [searching, setSearching] = useState(false)
  const [hotelError, setHotelError] = useState(null)

  // A booked hotel is looked up by name and pinned to a real address.
  const [hotelName, setHotelName] = useState('')
  const [hotelHits, setHotelHits] = useState([])
  const [locating, setLocating] = useState(false)

  const findBookedHotel = async () => {
    const q = hotelName.trim()
    if (!q || locating) return
    setLocating(true)
    setHotelError(null)
    breadcrumb('action', 'locate booked hotel')

    // Scoped to the destination so "Hilton" resolves in the right city.
    const hits = await search(`${q}, ${answers.destination}`, 5)
    setHotelHits(hits)
    if (hits.length === 0) setHotelError(t('לא מצאתי מלון בשם הזה ביעד. נסה שם מדויק יותר.'))
    setLocating(false)
  }

  const addStay = (stay) => {
    if (answers.stays.some((s) => s.label === stay.label)) return
    set({ stays: [...answers.stays, stay] })
    setHotelName('')
    setHotelHits([])
  }

  const set = (patch) => setAnswers((a) => ({ ...a, ...patch }))
  const setFlight = (patch) =>
    setAnswers((a) => ({ ...a, flight: { ...a.flight, ...patch, date: a.from } }))

  /* ---- travel parties ---- */

  // Whether more than one family is on this trip, asked up front rather
  // than inferred from how many party cards happen to exist. Inferring it
  // meant the per-family arrival/departure fields (and the fields validate
  // against) only appeared once a *second* family had already been added,
  // so the first family's own fields could silently stay unset — exactly
  // the gap that produced a before-arrival departure date for family 1 on
  // a real trip. Defaults to whatever is already true of `initial` (editing
  // a trip that already has multiple families reopens straight into that
  // state) rather than always starting on "just us".
  const [multiFamily, setMultiFamily] = useState(() => answers.parties.length > 1)

  const patchParty = (id, patch) =>
    set({ parties: answers.parties.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  // A member entered before ages existed is a bare string. Touching either
  // field upgrades it to { name, age } without disturbing the other one.
  const asMember = (m) => (typeof m === 'string' ? { name: m, age: '' } : m)

  const setMemberAge = (id, index, value) =>
    set({
      parties: answers.parties.map((p) =>
        p.id === id
          ? { ...p, members: p.members.map((m, i) => (i === index ? { ...asMember(m), age: value } : m)) }
          : p
      ),
    })

  // Nobody's name changes how a route gets built — only a headcount, and
  // (when the trip is for kids) how many of them are children, do. Growing
  // the count pads with blank travellers; shrinking trims from the end and
  // pulls kidsCount down with it so it can never exceed the new total.
  const setTravellerCount = (id, n) =>
    set({
      parties: answers.parties.map((p) => {
        if (p.id !== id) return p
        const clamped = Math.max(1, Math.min(20, n))
        const members =
          clamped > p.members.length
            ? [...p.members, ...Array.from({ length: clamped - p.members.length }, () => ({ name: '', age: '' }))]
            : p.members.slice(0, clamped)
        return { ...p, members, kidsCount: Math.min(p.kidsCount ?? 0, clamped) }
      }),
    })

  const setKidsCount = (id, n) =>
    set({
      parties: answers.parties.map((p) =>
        p.id === id ? { ...p, kidsCount: Math.max(0, Math.min(p.members.length, n)) } : p
      ),
    })

  const addParty = () =>
    set({
      parties: [
        ...answers.parties,
        {
          id: `p${Date.now()}`,
          name: '',
          members: [{ name: '', age: '' }],
          color: PARTY_COLORS[answers.parties.length % PARTY_COLORS.length],
        },
      ],
    })
  const steps = editMode ? STEPS : STEPS.filter((s) => FIRST_RUN.includes(s.id))
  const current = steps[step]
  const canAdvance = current.valid(answers)

  const nights = useMemo(() => {
    if (!answers.from || !answers.to) return 0
    const ms = new Date(answers.to) - new Date(answers.from)
    return Math.max(0, Math.round(ms / 86400000))
  }, [answers.from, answers.to])

  const travellers = answers.parties.reduce((n, p) => n + p.members.length, 0)

  /**
   * Asks the agent for hotels, using everything gathered so far rather than
   * the free-text box alone — destination, dates, style and headcount
   * all change what a sensible answer looks like.
   */
  const findHotels = async () => {
    if (searching) return
    breadcrumb('action', 'hotel search')
    setSearching(true)
    setHotelError(null)
    const done = watchdog('onboarding.hotelSearch', 25000, { city: answers.destination })

    const styleNames = TRAVEL_STYLES.filter((s) => answers.styles.includes(s.id))
      .map((s) => s.title)
      .join(', ')

    try {
      const text = await complete({
        system:
          'אתה סוכן נסיעות. החזר אך ורק שורות בפורמט: שם | אזור | טווח מחיר ללילה | משפט אחד למה מתאים. ' + // i18n-ignore — AI prompt; see gemini.js language override
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות. הכל בעברית פרט לשם המלון.', // i18n-ignore
        prompt:
          `יעד: ${answers.destination}${answers.country ? `, ${answers.country}` : ''}\n` + // i18n-ignore
          `תאריכים: ${answers.from} עד ${answers.to} (${nights} לילות)\n` + // i18n-ignore
          `נוסעים: ${travellers} ב-${answers.parties.length} משפחות\n` + // i18n-ignore
          `אופי הטיול: ${styleNames || 'לא צוין'}\n` + // i18n-ignore
          `בקשה חופשית: ${query.trim() || 'ללא העדפה מיוחדת'}\n\n` + // i18n-ignore
          'הצע 4 מלונות אמיתיים שמתאימים.', // i18n-ignore
      })

      const rows = parseRows(text, ['name', 'area', 'price', 'reason'])
      if (rows.length === 0) {
        setHotelError(t('לא הצלחתי לפענח את התשובה. נסה לנסח את הבקשה אחרת.'))
      }
      setHotels(rows)
    } catch (err) {
      setHotelError(err.message)
    } finally {
      done()
      setSearching(false)
    }
  }

  /* ---- Google Maps import ---- */
  const [importOpen, setImportOpen] = useState(false)
  const [finishing, setFinishing] = useState(false)

  // The map already answers "where", "when" and "where do you sleep" —
  // fill those in and move on to the dates, so they can be checked.
  const applyImport = (plan) => {
    set({
      imported: plan,
      ...(plan.destination ? {
        destination: plan.destination,
        country: plan.country,
        destinationEn: plan.destinationEn,
        lat: plan.lat,
        lng: plan.lng,
      } : {}),
      ...(plan.from && plan.to > plan.from ? { from: plan.from, to: plan.to } : {}),
      ...(plan.hotel ? { stays: [plan.hotel] } : {}),
    })
    setImportOpen(false)
    if (plan.destination) setStep(1)
  }

  const next = async () => {
    if (!canAdvance || finishing) return
    if (step < steps.length - 1) return setStep(step + 1)
    // Creating an imported trip waits on the agent filling in times for
    // every stop — several seconds with nothing to show otherwise.
    setFinishing(true)
    try {
      await onDone({ ...answers, nights, travellers })
    } finally {
      setFinishing(false)
    }
  }

  // Editing is not linear the way first-time onboarding is — someone who
  // opened this to fix one field should not have to click "הבא" through
  // every step after it just to save. The primary button still advances
  // normally for a full review; this is the way out at any point.
  const saveNow = () => {
    if (!canAdvance) return
    onDone({ ...answers, nights, travellers })
  }

  return (
    <>
      <div className="screen onboarding-screen">
        <header className="pad" style={{ paddingTop: 18 }}>
          <div className="between" style={{ marginBottom: 14 }}>
            <button
              className="icon-btn"
              onClick={() => {
                if (step > 0) setStep(step - 1)
                else if (editMode) onClose?.()
              }}
              aria-label={step === 0 && editMode ? t('סגור') : t('חזור')}
              disabled={step === 0 && !editMode}
            >
              {step === 0 && editMode ? <X size={20} /> : <ArrowRight size={20} />}
            </button>
            <span className="tiny" style={{ fontWeight: 500 }}>
              {t('שלב')} <span className="num">{step + 1}</span> {t('מתוך')}{' '}
              <span className="num">{steps.length}</span>
            </span>
          </div>
          <div className="progress">
            <i style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
        </header>

        {/* key forces the enter animation to replay on every question */}
        <div className="pad step-body" key={current.id} style={{ marginTop: 28 }}>
          <h1 className="h1">{current.title}</h1>
          <p className="sub" style={{ marginTop: 10, marginBottom: 24 }}>{current.sub}</p>

          {current.id === 'where' && (
            <>
              <div className="autocomplete">
                <div className="row field-row">
                  <MapPin size={18} />
                  <input
                    className="field-bare"
                    value={answers.destination}
                    onChange={(e) => {
                      set({ destination: e.target.value, country: '' })
                      lookupCity(e.target.value)
                    }}
                    placeholder={t('עיר או מדינה')}
                    aria-label={t('יעד הטיול')}
                    aria-autocomplete="list"
                    autoComplete="off"
                    autoFocus
                  />
                  {cityLoading && <span className="typing"><i /><i /><i /></span>}
                </div>

                {cityHits.length > 0 && (
                  <ul className="suggestions" role="listbox">
                    {cityHits.map((h) => (
                      <li key={`${h.lat},${h.lng}`}>
                        <button
                          onClick={() => {
                            set({
                              destination: h.name,
                              country: h.country,
                              // Kept for searches that need Latin text.
                              destinationEn: h.en ?? h.name,
                              // The coordinates behind the temperature/local
                              // time readout on Home — already resolved here,
                              // no reason to geocode the city again later.
                              lat: h.lat,
                              lng: h.lng,
                            })
                            setCityHits([])
                          }}
                        >
                          <span className="sug-emoji" aria-hidden="true">
                            {h.emoji ?? <MapPin size={14} />}
                          </span>
                          <span className="grow">
                            <strong>{h.name}</strong>
                            <span className="tiny">
                              {h.country}
                              {h.en && h.en !== h.name ? ` · ${h.en}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {!editMode && (
                answers.imported ? (
                  <div className="choice on row" style={{ marginTop: 14, gap: 10, alignItems: 'center', cursor: 'default' }}>
                    <Check size={18} />
                    <span className="grow" style={{ textAlign: 'start' }}>
                      <span className="choice-title" style={{ marginTop: 0 }}>
                        {t('יובא מ-Google Maps: {title}', { title: answers.imported.title || answers.destination })}
                      </span>
                      <span className="choice-sub">
                        <span className="num">{answers.imported.days.length}</span> {t('ימים')} ·{' '}
                        <span className="num">{answers.imported.days.reduce((n, d) => n + d.places.length, 0)}</span> {t('עצירות')}
                      </span>
                    </span>
                    <button className="icon-btn" onClick={() => set({ imported: undefined })} aria-label={t('בטל ייבוא')}>
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={() => setImportOpen(true)}>
                    <MapPin size={16} /> {t('יש לי כבר מסלול ב-Google Maps')}
                  </button>
                )
              )}

              <span className="label" style={{ marginTop: 18 }}>{t('יעדים פופולריים')}</span>
              <div className="dest-grid">
                {DESTINATIONS.map((d) => {
                  const on = answers.destination === d.city
                  return (
                    <button
                      key={d.id}
                      className={`dest ${on ? 'on' : ''}`}
                      onClick={() => {
                        // The Latin name rides along: flight and hotel searches
                        // return nothing for a Hebrew city name. Coordinates
                        // come from the same curated list this card's own
                        // city already lives in — no reason to geocode a
                        // place we already have the answer for.
                        const known = CITIES.find((c) => c.en === d.en)
                        set({
                          destination: d.city,
                          country: d.country,
                          destinationEn: d.en,
                          lat: known?.lat ?? null,
                          lng: known?.lng ?? null,
                        })
                      }}
                      aria-pressed={on}
                    >
                      <span className="dest-emoji" aria-hidden="true">{d.emoji}</span>
                      <span className="dest-city">{d.city}</span>
                      <span className="dest-country">{d.country}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {current.id === 'when' && (
            <>
              {/* The quick lengths come first — tapping "5 nights" is the
                  fastest way to fill the calendar below, and they used to sit
                  under it, past two flight-time fields. */}
              <span className="label">{t('כמה זמן?')}</span>
              <div className="pills" style={{ marginBottom: 14 }}>
                {[3, 5, 7, 10].map((d) => {
                  const start = answers.from || today
                  const end = new Date(start)
                  end.setDate(end.getDate() + d)
                  const iso = end.toISOString().slice(0, 10)
                  return (
                    <button
                      key={d}
                      className={`pill ${answers.from && answers.to === iso ? 'on' : ''}`}
                      onClick={() => set({ from: start, to: iso })}
                    >
                      <span className="num">{d}</span> {t('לילות')}
                    </button>
                  )
                })}
              </div>

              <DateRangeCalendar
                from={answers.from}
                to={answers.to}
                min={today}
                onChange={({ from, to }) => set({ from, to })}
              />

              {/* A line of text, not a box — it used to look like a field
                  you could type into. */}
              <p className={`range-summary ${nights > 0 ? 'on' : ''}`} aria-live="polite">
                <Calendar size={16} />
                {nights > 0 ? (
                  <span>
                    <strong className="num">{nights}</strong> {tn(nights, 'לילה', 'לילות')} ·{' '}
                    <strong className="num">{nights + 1}</strong> {tn(nights + 1, 'יום טיול', 'ימי טיול')}
                  </span>
                ) : (
                  <span>{answers.from ? t('עכשיו בחר את תאריך החזרה') : t('בחר תאריך יציאה וחזרה')}</span>
                )}
              </p>
            </>
          )}

          {current.id === 'style' && (
            <div className="choice-grid">
              {TRAVEL_STYLES.map((s) => {
                const on = answers.styles.includes(s.id)
                return (
                  <button
                    key={s.id}
                    className={`choice ${on ? 'on' : ''}`}
                    onClick={() =>
                      set({
                        styles: on
                          ? answers.styles.filter((x) => x !== s.id)
                          : [...answers.styles, s.id],
                      })
                    }
                    aria-pressed={on}
                  >
                    <span className="radio">{on && <Check size={11} />}</span>
                    <span className="choice-icon" aria-hidden="true">{s.emoji}</span>
                    <span>
                      <span className="choice-title">{s.title}</span>
                      <span className="choice-sub">{s.sub}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {current.id === "who" && (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 16 }}>
                <button
                  className={`choice ${!multiFamily ? "on" : ""}`}
                  style={{ flex: 1, padding: 13 }}
                  onClick={() => {
                    setMultiFamily(false)
                    // Not just hiding the extra cards — their data would
                    // otherwise resurface if "כמה משפחות" gets picked again,
                    // as families nobody meant to keep.
                    set({ parties: [{ ...answers.parties[0], arriveAt: null, departAt: null }] })
                  }}
                  aria-pressed={!multiFamily}
                >
                  <span className="radio">{!multiFamily && <Check size={11} />}</span>
                  {t('רק אנחנו')}
                </button>
                <button
                  className={`choice ${multiFamily ? "on" : ""}`}
                  style={{ flex: 1, padding: 13 }}
                  onClick={() => {
                    setMultiFamily(true)
                    if (answers.parties.length < 2) addParty()
                  }}
                  aria-pressed={multiFamily}
                >
                  <span className="radio">{multiFamily && <Check size={11} />}</span>
                  {t('כמה משפחות ביחד')}
                </button>
              </div>

              <div className="col" style={{ gap: 12 }}>
                {answers.parties.map((p, pi) => (
                  <div key={p.id} className={`party-card ${multiFamily && !p.name.trim() ? "needs" : ""}`}>
                    {/* A name only matters once there is more than one family
                        to tell apart — traveling solo, it would just be
                        typing for its own sake with nothing to distinguish. */}
                    {multiFamily && (
                      <div className="row" style={{ gap: 10 }}>
                        <span className="party-dot" style={{ background: p.color }} />
                        <input
                          className="field-bare grow"
                          value={p.name}
                          onChange={(e) => patchParty(p.id, { name: e.target.value })}
                          placeholder={t('שם המשפחה')}
                          aria-label={t('שם משפחה {n}', { n: pi + 1 })}
                        />
                        {answers.parties.length > 1 && (
                          <button
                            className="icon-btn" style={{ width: 28, height: 28 }}
                            onClick={() => set({ parties: answers.parties.filter((x) => x.id !== p.id) })}
                            aria-label={t('הסר את {name}', { name: p.name })}
                          ><X size={14} /></button>
                        )}
                      </div>
                    )}

                    {/* Only matters for a shared trip — a solo family's own
                        trip dates already say when they're there. Blank
                        means "the whole trip", same as today. Date and time
                        as two separate, separately-labeled fields rather
                        than one datetime-local control — the combined
                        widget's time segment reads as easy to miss, and the
                        time is exactly the part that's critical here
                        (arriving at 22:00 is not there for dinner even
                        though "day 3" started at midnight).
                        Gated on the explicit multiFamily toggle above, not
                        on how many party cards exist — shown for every
                        family including the first the moment "כמה משפחות"
                        is picked, so the first family's own dates are never
                        the one left unset just because it was here before
                        anyone else was added. */}
                    {multiFamily && (
                      <div className="col" style={{ gap: 10, marginTop: 10 }}>
                        <DateRangeCalendar
                          from={p.arriveAt?.split('T')[0] ?? ''}
                          to={p.departAt?.split('T')[0] ?? ''}
                          min={answers.from || today}
                          onChange={({ from, to }) => {
                            const arriveTime = p.arriveAt?.split('T')[1] ?? '00:00'
                            const departTime = p.departAt?.split('T')[1] ?? '00:00'
                            patchParty(p.id, {
                              arriveAt: from ? `${from}T${arriveTime}` : null,
                              departAt: to ? `${to}T${departTime}` : null,
                            })
                          }}
                        />
                        <div className="date-grid">
                          <label className="date-cell">
                            <span className="label">{t('שעת הגעה')}</span>
                            <select
                              className="field" value={p.arriveAt?.split('T')[1] ?? ''}
                              onChange={(e) => {
                                const date = p.arriveAt?.split('T')[0] ?? answers.from
                                patchParty(p.id, { arriveAt: date ? `${date}T${e.target.value || '00:00'}` : null })
                              }}
                              aria-label={t('שעת הגעה של {name}', { name: p.name })}
                            >
                              <option value="">{t('בחר שעה')}</option>
                              {TIME_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </label>
                          <label className="date-cell">
                            <span className="label">{t('שעת עזיבה')}</span>
                            <select
                              className="field" value={p.departAt?.split('T')[1] ?? ''}
                              onChange={(e) => {
                                const date = p.departAt?.split('T')[0] ?? answers.to
                                patchParty(p.id, { departAt: date ? `${date}T${e.target.value || '00:00'}` : null })
                              }}
                              aria-label={t('שעת עזיבה של {name}', { name: p.name })}
                            >
                              <option value="">{t('בחר שעה')}</option>
                              {TIME_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </label>
                        </div>
                      </div>
                    )}

                    <div className="row" style={{ marginTop: 12, gap: 10 }}>
                      <span className="grow" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-2)' }}>
                        {t('כמה נוסעים במשפחה')}
                      </span>
                      <span className="stepper">
                        <button
                          type="button"
                          onClick={() => setTravellerCount(p.id, p.members.length - 1)}
                          aria-label={t('פחות נוסעים ב{name}', { name: p.name })}
                        >−</button>
                        <span className="num">{p.members.length}</span>
                        <button
                          type="button"
                          onClick={() => setTravellerCount(p.id, p.members.length + 1)}
                          aria-label={t('עוד נוסעים ב{name}', { name: p.name })}
                        >+</button>
                      </span>
                    </div>

                    {/* Only asked for a trip with kids — an adult-only trip
                        has no use for a child headcount, let alone ages. */}
                    {answers.styles.includes('kids') && (
                      <>
                        <div className="row" style={{ marginTop: 10, gap: 10 }}>
                          <span className="grow" style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text-2)' }}>
                            {t('כמה מהם ילדים')}
                          </span>
                          <span className="stepper">
                            <button
                              type="button"
                              onClick={() => setKidsCount(p.id, (p.kidsCount ?? 0) - 1)}
                              aria-label={t('פחות ילדים ב{name}', { name: p.name })}
                            >−</button>
                            <span className="num">{p.kidsCount ?? 0}</span>
                            <button
                              type="button"
                              onClick={() => setKidsCount(p.id, (p.kidsCount ?? 0) + 1)}
                              aria-label={t('עוד ילדים ב{name}', { name: p.name })}
                            >+</button>
                          </span>
                        </div>

                        {(p.kidsCount ?? 0) > 0 && (
                          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            {Array.from({ length: p.kidsCount ?? 0 }).map((_, ki) => (
                              <label key={ki} className="col" style={{ gap: 3 }}>
                                <span className="tiny">{t('גיל ילד/ה {n}', { n: ki + 1 })}</span>
                                <input
                                  className="field" style={{ width: 64, padding: '8px 10px' }}
                                  type="number" min="0" max="17" inputMode="numeric"
                                  value={memberAge(p.members[ki])}
                                  onChange={(e) => setMemberAge(p.id, ki, e.target.value)}
                                  aria-label={t('גיל ילד {n} ב{name}', { n: ki + 1, name: p.name })}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {multiFamily && (
                <button
                  className="btn btn-ghost btn-block"
                  style={{ marginTop: 12 }}
                  onClick={addParty}
                  disabled={answers.parties.length >= 6}
                >
                  <Plus size={16} />
                  {t('הוסף משפחה')}
                </button>
              )}

              <div className="range-summary on" style={{ marginTop: 16 }}>
                <Users size={17} />
                <span>
                  {travellers === 1 ? t('נוסע אחד') : t('{n} נוסעים', { n: travellers })}
                  {answers.parties.length > 1 && <> · {t('{n} משפחות', { n: answers.parties.length })}</>}
                </span>
              </div>
            </>
          )}

          {current.id === 'food' && (
            <div className="pills">
              {CUISINES.map((c) => {
                const on = answers.cuisines.includes(c.id)
                return (
                  <button
                    key={c.id}
                    className={`pill ${on ? 'on' : ''}`}
                    onClick={() =>
                      set({
                        cuisines: on
                          ? answers.cuisines.filter((x) => x !== c.id)
                          : [...answers.cuisines, c.id],
                      })
                    }
                    aria-pressed={on}
                  >
                    <span style={{ marginInlineEnd: 6 }} aria-hidden="true">{c.emoji}</span>
                    {c.label}
                  </button>
                )
              })}
            </div>
          )}

          {current.id === 'flight' && (
            <>
              <span className="label">{t('טיסת הלוך')}</span>
              <div className="flight-grid">
                <label>
                  <span className="label">{t('חברת תעופה')}</span>
                  <input
                    className="field"
                    value={answers.flight.airline}
                    onChange={(e) => setFlight({ airline: e.target.value })}
                    placeholder={t('למשל: אל על')}
                    aria-label={t('חברת תעופה')}
                  />
                </label>
                <label>
                  <span className="label">{t('מספר טיסה')}</span>
                  <input
                    className="field ltr"
                    value={answers.flight.number}
                    onChange={(e) => setFlight({ number: e.target.value.toUpperCase() })}
                    placeholder={t('למשל: LY381')}
                    aria-label={t('מספר טיסה')}
                  />
                </label>
              </div>

              <label style={{ display: 'block', marginTop: 12 }}>
                <span className="label">{t('שדה תעופה בהגעה')}</span>
                <input
                  className="field"
                  value={answers.flight.arrivalAirport}
                  onChange={(e) => setFlight({ arrivalAirport: e.target.value })}
                  placeholder={t('נמל התעופה של {place}', { place: answers.destination || t('היעד') })}
                  aria-label={t('שדה תעופה בהגעה')}
                />
              </label>

              {/* Moved here from the dates step, where they sat between the
                  calendar and the trip length as if they were required. */}
              <div className="date-grid" style={{ marginTop: 12 }}>
                <label className="date-cell">
                  <span className="label">{t('שעת המראה ביציאה')}</span>
                  <select
                    className="field"
                    value={answers.departTime}
                    onChange={(e) => set({ departTime: e.target.value })}
                  >
                    <option value="">{t('לא ידוע עדיין')}</option>
                    {TIME_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>
                <label className="date-cell">
                  <span className="label">{t('שעת המראה בחזרה')}</span>
                  <select
                    className="field"
                    value={answers.returnTime}
                    onChange={(e) => set({ returnTime: e.target.value })}
                  >
                    <option value="">{t('לא ידוע עדיין')}</option>
                    {TIME_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </label>
              </div>

              <div className="card" style={{ marginTop: 18, background: 'var(--sunken)' }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                  <span style={{ color: 'var(--muted)' }}><Info size={15} /></span>
                  <p className="tiny" style={{ margin: 0 }}>
                    {t('שעות ההמראה והנחיתה מגיעות מחברת התעופה, לא מהסוכן — אין לו גישה למאגר טיסות חי, והוא היה מנחש. נשמור את הפרטים וניתן לך קישור ישיר למעקב אחרי הטיסה.')}
                  </p>
                </div>
              </div>

              <p className="tiny" style={{ marginTop: 14 }}>
                {t('אחרי שנדע את שדה התעופה והמלון, הסוכן ימליץ איך להגיע ביניהם — רכבת, שאטל, מונית או הסעה פרטית.')}
              </p>
            </>
          )}

          {current.id === 'stay' && (
            <>
              {/* The first question decides which of two flows follows. */}
              <div className="segmented" role="group" aria-label={t('האם הוזמן מלון')}>
                <button className={booked === 'yes' ? 'on' : ''} onClick={() => setBooked('yes')}>
                  <Check size={15} /> {t('כבר הזמנו')}
                </button>
                <button className={booked === 'no' ? 'on' : ''} onClick={() => setBooked('no')}>
                  <Sparkles size={15} /> {t('עוד מחפשים')}
                </button>
              </div>

              {/* Stays chosen so far, in either flow. */}
              {answers.stays.length > 0 && (
                <div className="col" style={{ gap: 9, marginTop: 20 }}>
                  <span className="label" style={{ marginBottom: 0 }}>
                    {t('הלינה שלכם')} ({answers.stays.length})
                  </span>
                  {answers.stays.map((s, i) => (
                    <div key={s.label} className="party-row">
                      <span className="stay-index num">{i + 1}</span>
                      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                        <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</strong>
                        <span className="tiny stay-address">{s.label}</span>
                      </span>
                      <button
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        onClick={() => set({ stays: answers.stays.filter((x) => x.label !== s.label) })}
                        aria-label={t('הסר את {name}', { name: s.name })}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <p className="tiny">
                    {t('אפשר להוסיף עוד מלון — שימושי כשהטיול עובר בין ערים או כשכל משפחה ישנה במקום אחר.')}
                  </p>
                </div>
              )}

              {booked === 'yes' && (
                <div style={{ marginTop: 20 }}>
                  <span className="label">{t('שם המלון')}</span>
                  <div className="row field-row">
                    <Bed size={18} />
                    <input
                      className="field-bare"
                      value={hotelName}
                      onChange={(e) => setHotelName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && findBookedHotel()}
                      placeholder={t('לדוגמה: Hilton {city}', { city: answers.destination })}
                      aria-label={t('שם המלון שהוזמן')}
                    />
                    {locating && <span className="typing"><i /><i /><i /></span>}
                  </div>

                  <button
                    className="btn btn-ghost btn-block"
                    style={{ marginTop: 10 }}
                    onClick={findBookedHotel}
                    disabled={locating || !hotelName.trim()}
                  >
                    <MapPin size={16} />
                    {t('אתר את המיקום')}
                  </button>

                  {hotelHits.length > 0 && (
                    <>
                      <span className="label" style={{ marginTop: 20 }}>
                        {hotelHits.length === 1 ? t('נמצא') : t('נמצאו כמה — בחר את הנכון')}
                      </span>
                      <div className="col" style={{ gap: 9 }}>
                        {hotelHits.map((h) => (
                          <button
                            key={`${h.lat},${h.lng}`}
                            className="choice"
                            style={{ padding: 13 }}
                            onClick={() =>
                              addStay({ name: h.name, label: h.label, lat: h.lat, lng: h.lng })
                            }
                          >
                            <span className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                              <span style={{ color: 'var(--lav)', marginTop: 2 }}><MapPin size={15} /></span>
                              <span className="grow" style={{ textAlign: 'start', minWidth: 0 }}>
                                <span className="choice-title" style={{ marginTop: 0 }}>{h.name}</span>
                                <span className="choice-sub stay-address">{h.label}</span>
                                <span className="tiny num" style={{ display: 'block', marginTop: 5 }}>
                                  {h.lat.toFixed(4)}, {h.lng.toFixed(4)}
                                </span>
                              </span>
                              <Plus size={16} />
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {booked === 'no' && (
                <div style={{ marginTop: 20 }}>
                  <span className="label">{t('מה חשוב לך?')}</span>
                  <div className="row field-row" style={{ marginBottom: 12 }}>
                    <Sparkles size={18} />
                    <input
                      className="field-bare"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && findHotels()}
                      placeholder={t('קרוב למרכז, עם בריכה, שקט בלילה...')}
                      aria-label={t('חיפוש חופשי של מלון')}
                    />
                  </div>

              {hasAI ? (
                <button
                  className="btn btn-primary btn-block"
                  onClick={findHotels}
                  disabled={searching}
                >
                  {searching ? (
                    <>
                      <span className="typing"><i /><i /><i /></span>
                      {t('מחפש ב{city}...', { city: answers.destination })}
                    </>
                  ) : (
                    <>
                      <Sparkles size={17} />
                      {t('מצא לי מלונות')}
                    </>
                  )}
                </button>
              ) : (
                <p className="tiny">
                  {t('חיפוש חכם דורש חיבור לסוכן ה-AI. אפשר להקליד שם מלון ידנית ולהמשיך.')}
                </p>
              )}

              {hotelError && (
                <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>
                  {hotelError}
                </p>
              )}

              {hotels.length > 0 && (
                <>
                  <span className="label" style={{ marginTop: 22 }}>{t('הצעות הסוכן')}</span>
                  <div className="col" style={{ gap: 10 }}>
                    {hotels.map((h) => {
                      const on = answers.stays.some((s) => s.name === h.name)
                      // The agent knows which hotels exist. It does not know
                      // what they cost on your dates — that number is an
                      // estimate out of training data. So the card selects,
                      // and a second link goes to a real price.
                      const booking = `https://www.google.com/travel/search?q=${encodeURIComponent(
                        `${h.name} ${answers.destinationEn ?? answers.destination}`
                      )}`
                      return (
                        <div key={h.name} className="hotel-choice">
                        <button
                          className={`choice ${on ? 'on' : ''}`}
                          style={{ padding: 14 }}
                          // Suggestions come back as names; pin the chosen one
                          // to a real address before it joins the list.
                          onClick={async () => {
                            if (on) {
                              set({ stays: answers.stays.filter((s) => s.name !== h.name) })
                              return
                            }
                            setLocating(true)
                            const hit = await geocode(`${h.name}, ${answers.destination}`)
                            setLocating(false)
                            addStay({
                              name: h.name,
                              label: hit?.label ?? `${h.area}, ${answers.destination}`,
                              lat: hit?.lat ?? null,
                              lng: hit?.lng ?? null,
                            })
                          }}
                          aria-pressed={on}
                        >
                          <span className="between" style={{ alignItems: 'flex-start' }}>
                            <span className="grow" style={{ textAlign: 'start' }}>
                              <span className="choice-title" style={{ marginTop: 0 }}>
                                {h.name}
                              </span>
                              <span className="choice-sub">{h.area}</span>
                            </span>
                            {/* The tilde is the whole point: this is a guess,
                                and it should not look like a quote. */}
                            <span className="hotel-price num">≈ {h.price}</span>
                          </span>
                          <span className="choice-sub" style={{ marginTop: 8 }}>{h.reason}</span>
                          {on && (
                            <span className="badge" style={{ marginTop: 10 }}>
                              <Check size={11} /> {t('נבחר')}
                            </span>
                          )}
                        </button>
                        <a
                          className="hotel-verify"
                          href={booking}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Navigation size={12} />
                          {t('מחיר וזמינות אמיתיים')}
                        </a>
                        </div>
                      )
                    })}
                  </div>
                  <p className="tiny" style={{ marginTop: 12 }}>
                    <Info size={12} /> {t('המלונות אמיתיים — המחירים הם הערכה של מודל שפה, לא מחיר חי. לחץ "מחיר וזמינות אמיתיים" כדי לראות כמה זה עולה בתאריכים שלך.')}
                  </p>
                </>
              )}
                </div>
              )}

              {booked === null && (
                <p className="tiny" style={{ marginTop: 20 }}>
                  {t('אפשר גם לדלג — המסלול ייבנה בלי נקודת לינה, ותוכל להוסיף אותה אחר כך.')}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="cta-bar">
        {/* A disabled button with no explanation is a dead end — the user can
            see it is grey but not why. Say what is missing. */}
        {!canAdvance && current.blocker && (
          <p className="cta-blocker">
            <Info size={13} />
            {current.blocker(answers)}
          </p>
        )}
        <button className="btn btn-primary btn-block" onClick={next} disabled={!canAdvance || finishing}>
          {finishing
            ? (answers.imported ? t('מייבא את המסלול…') : t('יוצר את הטיול…'))
            : step < steps.length - 1 ? t('הבא') : editMode ? t('שמור שינויים') : t('בנו לי את המסלול')}
          {!finishing && <ArrowLeft size={18} />}
        </button>
        {editMode && step < steps.length - 1 && (
          <button
            className="btn btn-ghost btn-block"
            onClick={saveNow}
            disabled={!canAdvance}
            style={{ marginTop: 8 }}
          >
            {t('שמור וסגור')}
          </button>
        )}
      </div>

      <MapImportSheet open={importOpen} onClose={() => setImportOpen(false)} onImport={applyImport} />
    </>
  )
}
