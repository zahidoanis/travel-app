import { useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Mic, Bot, Plus, X, Users, MapPin, Calendar,
  Bed, Sparkles, Info,
} from '../components/Icons'
import { TRAVEL_STYLES, DESTINATIONS, PARTY_COLORS, CUISINES } from '../data'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { search, geocode } from '../lib/geocode'
import { searchCities } from '../cities'
import { breadcrumb, watchdog } from '../lib/telemetry'
import AgentCard from '../components/AgentCard'

/**
 * One question per screen. Each step declares its own validity, so the CTA
 * enables itself rather than every step re-implementing the same check.
 */
const STEPS = [
  {
    id: 'where',
    title: 'לאן נוסעים?',
    sub: 'בחר יעד מהרשימה או הקלד יעד משלך.',
    hint: 'יש יעד שאתה מתלבט לגביו? ספר לי ואעזור להחליט.',
    valid: (a) => a.destination.trim().length > 1,
  },
  {
    id: 'when',
    title: 'מתי?',
    sub: 'טווח התאריכים קובע את חלוקת הימים במסלול.',
    hint: 'לא בטוח בתאריכים? אמור לי כמה ימים בערך ואציע חלון.',
    valid: (a) => Boolean(a.from && a.to && a.to > a.from),
  },
  {
    id: 'style',
    title: 'מה אופי הטיול?',
    sub: 'אפשר לבחור כמה. זה משפיע על סוג העצירות שנציע.',
    hint: 'רוצה לפרט יותר על חופשת החלומות שלך? אני כאן כדי להקשיב.',
    valid: (a) => a.styles.length > 0,
  },
  {
    id: 'who',
    title: 'מי מטייל?',
    sub: 'שם המשפחה ושמות המשתתפים. כך אפשר לפצל מסלולים והוצאות.',
    hint: 'כל משפחה מקבלת צבע משלה במפה ובלו"ז.',
    valid: (a) =>
      a.parties.length > 0 &&
      a.parties.every((p) => p.name.trim() && p.members.some((m) => m.trim())),
  },
  {
    id: 'food',
    title: 'מה אוהבים לאכול?',
    sub: 'ההעדפות האלה מסננות את המלצות המסעדות לאורך כל הטיול.',
    hint: 'יש אלרגיה או משהו שאתם לא אוכלים? כתבו לי ואתחשב בזה.',
    valid: (a) => a.cuisines.length > 0,
  },
  {
    id: 'flight',
    title: 'איך מגיעים?',
    sub: 'מספר טיסה וחברת תעופה — כדי שנוכל לתכנן את ההגעה למלון.',
    hint: 'לא זוכר את מספר הטיסה? אפשר לדלג ולהוסיף אחר כך.',
    valid: () => true,
  },
  {
    id: 'stay',
    title: 'איפה תישנו?',
    sub: 'אם כבר הזמנתם — נאתר את המלון על המפה. אם לא, הסוכן ימצא לכם.',
    hint: 'אפשר להוסיף כמה מלונות, אם הטיול עובר בין ערים.',
    // Optional — a trip is plannable without a hotel picked yet.
    valid: () => true,
  },
]

const today = new Date().toISOString().slice(0, 10)

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0)


  const [answers, setAnswers] = useState({
    destination: '',
    country: '',
    from: '',
    to: '',
    styles: [],
    parties: [{ id: 'p1', name: '', members: [''], color: PARTY_COLORS[0] }],
    cuisines: ['local'],
    flight: { airline: '', number: '', arrivalAirport: '', date: '' },
    stays: [],
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
    setCityHits(local.map((c) => ({ ...c, name: c.he, source: 'local' })))

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
    if (hits.length === 0) setHotelError('לא מצאתי מלון בשם הזה ביעד. נסה שם מדויק יותר.')
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

  const patchParty = (id, patch) =>
    set({ parties: answers.parties.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  const setMember = (id, index, value) =>
    set({
      parties: answers.parties.map((p) =>
        p.id === id
          ? { ...p, members: p.members.map((m, i) => (i === index ? value : m)) }
          : p
      ),
    })

  const addMember = (id) =>
    set({
      parties: answers.parties.map((p) =>
        p.id === id && p.members.length < 12 ? { ...p, members: [...p.members, ''] } : p
      ),
    })

  const removeMember = (id, index) =>
    set({
      parties: answers.parties.map((p) =>
        p.id === id ? { ...p, members: p.members.filter((_, i) => i !== index) } : p
      ),
    })

  const addParty = () =>
    set({
      parties: [
        ...answers.parties,
        {
          id: `p${Date.now()}`,
          name: '',
          members: [''],
          color: PARTY_COLORS[answers.parties.length % PARTY_COLORS.length],
        },
      ],
    })
  const current = STEPS[step]
  const canAdvance = current.valid(answers)

  const nights = useMemo(() => {
    if (!answers.from || !answers.to) return 0
    const ms = new Date(answers.to) - new Date(answers.from)
    return Math.max(0, Math.round(ms / 86400000))
  }, [answers.from, answers.to])

  const travellers = answers.parties.reduce((n, p) => n + p.members.filter((m) => m.trim()).length, 0)

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
          'אתה סוכן נסיעות. החזר אך ורק שורות בפורמט: שם | אזור | טווח מחיר ללילה | משפט אחד למה מתאים. ' +
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות. הכל בעברית פרט לשם המלון.',
        prompt:
          `יעד: ${answers.destination}${answers.country ? `, ${answers.country}` : ''}\n` +
          `תאריכים: ${answers.from} עד ${answers.to} (${nights} לילות)\n` +
          `נוסעים: ${travellers} ב-${answers.parties.length} משפחות\n` +
          `אופי הטיול: ${styleNames || 'לא צוין'}\n` +
          `בקשה חופשית: ${query.trim() || 'ללא העדפה מיוחדת'}\n\n` +
          'הצע 4 מלונות אמיתיים שמתאימים.',
      })

      const rows = parseRows(text, ['name', 'area', 'price', 'reason'])
      if (rows.length === 0) {
        setHotelError('לא הצלחתי לפענח את התשובה. נסה לנסח את הבקשה אחרת.')
      }
      setHotels(rows)
    } catch (err) {
      setHotelError(err.message)
    } finally {
      done()
      setSearching(false)
    }
  }

  /**
   * What the agent knows when the user asks it something. Everything answered
   * so far, so a question on step 4 is not answered as if it were step 1.
   */
  const agentContext = [
    `השאלה הנוכחית: ${current.title}`,
    answers.destination && `יעד שנבחר: ${answers.destination} ${answers.country}`,
    answers.from && answers.to && `תאריכים: ${answers.from} עד ${answers.to} (${nights} לילות)`,
    answers.styles.length > 0 &&
      `אופי: ${TRAVEL_STYLES.filter((s) => answers.styles.includes(s.id)).map((s) => s.title).join(', ')}`,
    `נוסעים: ${travellers} ב-${answers.parties.length} משפחות`,
    answers.cuisines.length > 0 &&
      `העדפות אוכל: ${CUISINES.filter((c) => answers.cuisines.includes(c.id)).map((c) => c.label).join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n')

  const next = () => {
    if (!canAdvance) return
    if (step < STEPS.length - 1) setStep(step + 1)
    else onDone({ ...answers, nights, travellers })
  }

  return (
    <>
      <div className="screen onboarding-screen">
        <header className="pad" style={{ paddingTop: 18 }}>
          <div className="between" style={{ marginBottom: 14 }}>
            <button
              className="icon-btn"
              onClick={() => step > 0 && setStep(step - 1)}
              aria-label="חזור"
              disabled={step === 0}
            >
              <ArrowRight size={20} />
            </button>
            <span className="tiny" style={{ fontWeight: 500 }}>
              שלב <span className="num">{step + 1}</span> מתוך{' '}
              <span className="num">{STEPS.length}</span>
            </span>
          </div>
          <div className="progress">
            <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
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
                    placeholder="עיר או מדינה"
                    aria-label="יעד הטיול"
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
                            set({ destination: h.name, country: h.country })
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

              <span className="label" style={{ marginTop: 18 }}>יעדים פופולריים</span>
              <div className="dest-grid">
                {DESTINATIONS.map((d) => {
                  const on = answers.destination === d.city
                  return (
                    <button
                      key={d.id}
                      className={`dest ${on ? 'on' : ''}`}
                      onClick={() => set({ destination: d.city, country: d.country })}
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
              <div className="date-grid">
                <label className="date-cell">
                  <span className="label">יציאה</span>
                  <input
                    type="date"
                    className="field"
                    min={today}
                    value={answers.from}
                    onChange={(e) => {
                      const from = e.target.value
                      // Keep the range coherent if the new start passes the end.
                      set({ from, to: answers.to && answers.to <= from ? '' : answers.to })
                    }}
                  />
                </label>
                <label className="date-cell">
                  <span className="label">חזרה</span>
                  <input
                    type="date"
                    className="field"
                    min={answers.from || today}
                    value={answers.to}
                    onChange={(e) => set({ to: e.target.value })}
                  />
                </label>
              </div>

              <div className={`range-summary ${nights > 0 ? 'on' : ''}`}>
                <Calendar size={17} />
                {nights > 0 ? (
                  <span>
                    <strong className="num">{nights}</strong> לילות ·{' '}
                    <strong className="num">{nights + 1}</strong> ימי טיול
                  </span>
                ) : (
                  <span className="tiny">בחר תאריך יציאה וחזרה</span>
                )}
              </div>

              <div className="pills" style={{ marginTop: 18 }}>
                {[3, 5, 7, 10].map((d) => (
                  <button
                    key={d}
                    className="pill"
                    onClick={() => {
                      const start = answers.from || today
                      const end = new Date(start)
                      end.setDate(end.getDate() + d)
                      set({ from: start, to: end.toISOString().slice(0, 10) })
                    }}
                  >
                    <span className="num">{d}</span> לילות
                  </button>
                ))}
              </div>
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
              <div className="col" style={{ gap: 12 }}>
                {answers.parties.map((p, pi) => (
                  <div key={p.id} className="party-card">
                    <div className="row" style={{ gap: 10 }}>
                      <span className="party-dot" style={{ background: p.color }} />
                      <input
                        className="field-bare grow"
                        value={p.name}
                        onChange={(e) => patchParty(p.id, { name: e.target.value })}
                        placeholder="שם המשפחה"
                        aria-label={`שם משפחה ${pi + 1}`}
                      />
                      {answers.parties.length > 1 && (
                        <button
                          className="icon-btn" style={{ width: 28, height: 28 }}
                          onClick={() => set({ parties: answers.parties.filter((x) => x.id !== p.id) })}
                          aria-label={`הסר את ${p.name}`}
                        ><X size={14} /></button>
                      )}
                    </div>

                    <div className="member-list">
                      {p.members.map((m, mi) => (
                        <div key={mi} className="member-row">
                          <span className="member-index num">{mi + 1}</span>
                          <input
                            className="field-bare grow"
                            value={m}
                            onChange={(e) => setMember(p.id, mi, e.target.value)}
                            placeholder={mi === 0 ? "שם המבוגר האחראי" : "שם המשתתף"}
                            aria-label={`משתתף ${mi + 1} ב${p.name}`}
                          />
                          {p.members.length > 1 && (
                            <button
                              className="icon-btn" style={{ width: 26, height: 26 }}
                              onClick={() => removeMember(p.id, mi)}
                              aria-label="הסר משתתף"
                            ><X size={12} /></button>
                          )}
                        </div>
                      ))}
                    </div>

                    <button className="add-member" onClick={() => addMember(p.id)}>
                      <Plus size={13} /> הוסף משתתף
                    </button>
                  </div>
                ))}
              </div>

              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 12 }}
                onClick={addParty}
                disabled={answers.parties.length >= 6}
              >
                <Plus size={16} />
                הוסף משפחה
              </button>

              <div className="range-summary on" style={{ marginTop: 16 }}>
                <Users size={17} />
                <span>
                  <strong className="num">{travellers}</strong> נוסעים ב-
                  <strong className="num">{answers.parties.length}</strong>{" "}
                  {answers.parties.length === 1 ? "משפחה" : "משפחות"}
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
              <span className="label">טיסת הלוך</span>
              <div className="flight-grid">
                <label>
                  <span className="label">חברת תעופה</span>
                  <input
                    className="field"
                    value={answers.flight.airline}
                    onChange={(e) => setFlight({ airline: e.target.value })}
                    placeholder="El Al / Wizz Air"
                    aria-label="חברת תעופה"
                  />
                </label>
                <label>
                  <span className="label">מספר טיסה</span>
                  <input
                    className="field ltr"
                    value={answers.flight.number}
                    onChange={(e) => setFlight({ number: e.target.value.toUpperCase() })}
                    placeholder="LY381"
                    aria-label="מספר טיסה"
                  />
                </label>
              </div>

              <label style={{ display: 'block', marginTop: 12 }}>
                <span className="label">שדה תעופה בהגעה</span>
                <input
                  className="field"
                  value={answers.flight.arrivalAirport}
                  onChange={(e) => setFlight({ arrivalAirport: e.target.value })}
                  placeholder={`נמל התעופה של ${answers.destination || 'היעד'}`}
                  aria-label="שדה תעופה בהגעה"
                />
              </label>

              <div className="card" style={{ marginTop: 18, background: 'var(--sunken)' }}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
                  <span style={{ color: 'var(--muted)' }}><Info size={15} /></span>
                  <p className="tiny" style={{ margin: 0 }}>
                    שעות ההמראה והנחיתה מגיעות מחברת התעופה, לא מהסוכן — אין לו גישה
                    למאגר טיסות חי, והוא היה מנחש. נשמור את הפרטים וניתן לך קישור
                    ישיר למעקב אחרי הטיסה.
                  </p>
                </div>
              </div>

              <p className="tiny" style={{ marginTop: 14 }}>
                אחרי שנדע את שדה התעופה והמלון, הסוכן ימליץ איך להגיע ביניהם —
                רכבת, שאטל, מונית או הסעה פרטית.
              </p>
            </>
          )}

          {current.id === 'stay' && (
            <>
              {/* The first question decides which of two flows follows. */}
              <div className="segmented" role="group" aria-label="האם הוזמן מלון">
                <button className={booked === 'yes' ? 'on' : ''} onClick={() => setBooked('yes')}>
                  <Check size={15} /> כבר הזמנו
                </button>
                <button className={booked === 'no' ? 'on' : ''} onClick={() => setBooked('no')}>
                  <Sparkles size={15} /> עוד מחפשים
                </button>
              </div>

              {/* Stays chosen so far, in either flow. */}
              {answers.stays.length > 0 && (
                <div className="col" style={{ gap: 9, marginTop: 20 }}>
                  <span className="label" style={{ marginBottom: 0 }}>
                    הלינה שלכם ({answers.stays.length})
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
                        aria-label={`הסר את ${s.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <p className="tiny">
                    אפשר להוסיף עוד מלון — שימושי כשהטיול עובר בין ערים או כשכל משפחה ישנה במקום אחר.
                  </p>
                </div>
              )}

              {booked === 'yes' && (
                <div style={{ marginTop: 20 }}>
                  <span className="label">שם המלון</span>
                  <div className="row field-row">
                    <Bed size={18} />
                    <input
                      className="field-bare"
                      value={hotelName}
                      onChange={(e) => setHotelName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && findBookedHotel()}
                      placeholder={`לדוגמה: Hilton ${answers.destination}`}
                      aria-label="שם המלון שהוזמן"
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
                    אתר את המיקום
                  </button>

                  {hotelHits.length > 0 && (
                    <>
                      <span className="label" style={{ marginTop: 20 }}>
                        {hotelHits.length === 1 ? 'נמצא' : 'נמצאו כמה — בחר את הנכון'}
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
                  <span className="label">מה חשוב לך?</span>
                  <div className="row field-row" style={{ marginBottom: 12 }}>
                    <Sparkles size={18} />
                    <input
                      className="field-bare"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && findHotels()}
                      placeholder="קרוב למרכז, עם בריכה, שקט בלילה..."
                      aria-label="חיפוש חופשי של מלון"
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
                      מחפש ב{answers.destination}...
                    </>
                  ) : (
                    <>
                      <Sparkles size={17} />
                      מצא לי מלונות
                    </>
                  )}
                </button>
              ) : (
                <p className="tiny">
                  חיפוש חכם דורש חיבור לסוכן ה-AI. אפשר להקליד שם מלון ידנית ולהמשיך.
                </p>
              )}

              {hotelError && (
                <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>
                  {hotelError}
                </p>
              )}

              {hotels.length > 0 && (
                <>
                  <span className="label" style={{ marginTop: 22 }}>הצעות הסוכן</span>
                  <div className="col" style={{ gap: 10 }}>
                    {hotels.map((h) => {
                      const on = answers.stays.some((s) => s.name === h.name)
                      return (
                        <button
                          key={h.name}
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
                            <span className="hotel-price num">{h.price}</span>
                          </span>
                          <span className="choice-sub" style={{ marginTop: 8 }}>{h.reason}</span>
                          {on && (
                            <span className="badge" style={{ marginTop: 10 }}>
                              <Check size={11} /> נבחר
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                  <p className="tiny" style={{ marginTop: 12 }}>
                    ההצעות נוצרו על ידי מודל שפה — ודא זמינות ומחיר לפני הזמנה.
                  </p>
                </>
              )}
                </div>
              )}

              {booked === null && (
                <p className="tiny" style={{ marginTop: 20 }}>
                  אפשר גם לדלג — המסלול ייבנה בלי נקודת לינה, ותוכל להוסיף אותה אחר כך.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* The agent's prompt follows the question being asked. */}
      <AgentCard
        step={current.id}
        hint={current.hint}
        context={agentContext}
        onPick={
          current.id === "where"
            ? (p) => { set({ destination: p.city, country: p.country }); setCityHits([]) }
            : undefined
        }
      />

      <div className="cta-bar">
        <button className="btn btn-primary btn-block" onClick={next} disabled={!canAdvance}>
          {step < STEPS.length - 1 ? 'הבא' : 'בוא נתחיל'}
          <ArrowLeft size={18} />
        </button>
      </div>
    </>
  )
}
