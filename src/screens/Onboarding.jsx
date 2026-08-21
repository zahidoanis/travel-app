import { useMemo, useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Mic, Bot, Plus, X, Users, MapPin, Calendar,
  Bed, Sparkles,
} from '../components/Icons'
import { TRAVEL_STYLES, BUDGETS, DESTINATIONS, PARTY_COLORS } from '../data'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { breadcrumb, watchdog } from '../lib/telemetry'

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
    id: 'budget',
    title: 'מה התקציב היומי?',
    sub: 'לאדם, לא כולל טיסות ולינה.',
    hint: 'אפשר גם לומר לי סכום מדויק ואתאים את ההצעות.',
    valid: () => true,
  },
  {
    id: 'who',
    title: 'מי מטייל?',
    sub: 'חלק את הקבוצה למשפחות — כך אפשר לפצל מסלולים והוצאות.',
    hint: 'כל משפחה מקבלת צבע משלה במפה ובלו"ז.',
    valid: (a) => a.parties.length > 0 && a.parties.every((p) => p.name.trim() && p.size > 0),
  },
  {
    id: 'stay',
    title: 'איפה תישנו?',
    sub: 'הקלד מה חשוב לך, והסוכן יחפש מלונות שמתאימים ליעד ולתקציב.',
    hint: 'לדוגמה: "קרוב למרכז, עם בריכה, שקט בלילה".',
    // Optional — a trip is plannable without a hotel picked yet.
    valid: () => true,
  },
]

const today = new Date().toISOString().slice(0, 10)

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0)
  const [listening, setListening] = useState(false)
  const [note, setNote] = useState('')

  const [answers, setAnswers] = useState({
    destination: '',
    country: '',
    from: '',
    to: '',
    styles: [],
    budget: 'mid',
    parties: [{ id: 'p1', name: 'המשפחה שלי', size: 2, color: PARTY_COLORS[0] }],
    hotel: '',
  })

  /* ---- hotel search ---- */
  const [query, setQuery] = useState('')
  const [hotels, setHotels] = useState([])
  const [searching, setSearching] = useState(false)
  const [hotelError, setHotelError] = useState(null)

  const set = (patch) => setAnswers((a) => ({ ...a, ...patch }))
  const current = STEPS[step]
  const canAdvance = current.valid(answers)

  const nights = useMemo(() => {
    if (!answers.from || !answers.to) return 0
    const ms = new Date(answers.to) - new Date(answers.from)
    return Math.max(0, Math.round(ms / 86400000))
  }, [answers.from, answers.to])

  const travellers = answers.parties.reduce((n, p) => n + p.size, 0)

  /**
   * Asks the agent for hotels, using everything gathered so far rather than
   * the free-text box alone — destination, dates, budget, style and headcount
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
    const budgetName = BUDGETS.find((b) => b.id === answers.budget)?.label ?? ''

    try {
      const text = await complete({
        system:
          'אתה סוכן נסיעות. החזר אך ורק שורות בפורמט: שם | אזור | טווח מחיר ללילה | משפט אחד למה מתאים. ' +
          'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות. הכל בעברית פרט לשם המלון.',
        prompt:
          `יעד: ${answers.destination}${answers.country ? `, ${answers.country}` : ''}\n` +
          `תאריכים: ${answers.from} עד ${answers.to} (${nights} לילות)\n` +
          `נוסעים: ${travellers} ב-${answers.parties.length} משפחות\n` +
          `תקציב יומי לאדם: ${budgetName}\n` +
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

  const next = () => {
    if (!canAdvance) return
    if (step < STEPS.length - 1) setStep(step + 1)
    else onDone({ ...answers, nights, travellers, note: note.trim() })
  }

  return (
    <>
      <div className="screen" style={{ paddingBottom: 210 }}>
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
              <div className="row field-row" style={{ marginBottom: 18 }}>
                <MapPin size={18} />
                <input
                  className="field-bare"
                  value={answers.destination}
                  onChange={(e) => set({ destination: e.target.value, country: '' })}
                  placeholder="עיר או מדינה"
                  aria-label="יעד הטיול"
                  autoFocus
                />
              </div>

              <span className="label">יעדים פופולריים</span>
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

          {current.id === 'budget' && (
            <div className="col" style={{ gap: 11 }}>
              {BUDGETS.map((b) => {
                const on = answers.budget === b.id
                return (
                  <button
                    key={b.id}
                    className={`choice ${on ? 'on' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                    onClick={() => set({ budget: b.id })}
                    aria-pressed={on}
                  >
                    <span className="budget-mark">{b.label.split(' - ')[0]}</span>
                    <span className="grow" style={{ textAlign: 'start' }}>
                      <span className="choice-title" style={{ marginTop: 0 }}>
                        {b.label.split(' - ')[1]}
                      </span>
                    </span>
                    {on && <Check size={16} />}
                  </button>
                )
              })}
            </div>
          )}

          {current.id === 'who' && (
            <>
              <div className="col" style={{ gap: 10 }}>
                {answers.parties.map((p, i) => (
                  <div key={p.id} className="party-row">
                    <span className="party-dot" style={{ background: p.color }} />
                    <input
                      className="field-bare grow"
                      value={p.name}
                      onChange={(e) =>
                        set({
                          parties: answers.parties.map((x) =>
                            x.id === p.id ? { ...x, name: e.target.value } : x
                          ),
                        })
                      }
                      placeholder="שם המשפחה"
                      aria-label={`שם משפחה ${i + 1}`}
                    />
                    <span className="stepper">
                      <button
                        onClick={() =>
                          set({
                            parties: answers.parties.map((x) =>
                              x.id === p.id ? { ...x, size: Math.max(1, x.size - 1) } : x
                            ),
                          })
                        }
                        aria-label="פחות נוסעים"
                      >
                        −
                      </button>
                      <span className="num">{p.size}</span>
                      <button
                        onClick={() =>
                          set({
                            parties: answers.parties.map((x) =>
                              x.id === p.id ? { ...x, size: Math.min(12, x.size + 1) } : x
                            ),
                          })
                        }
                        aria-label="עוד נוסעים"
                      >
                        +
                      </button>
                    </span>
                    {answers.parties.length > 1 && (
                      <button
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        onClick={() =>
                          set({ parties: answers.parties.filter((x) => x.id !== p.id) })
                        }
                        aria-label={`הסר את ${p.name}`}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 12 }}
                onClick={() =>
                  set({
                    parties: [
                      ...answers.parties,
                      {
                        id: `p${Date.now()}`,
                        name: '',
                        size: 2,
                        color: PARTY_COLORS[answers.parties.length % PARTY_COLORS.length],
                      },
                    ],
                  })
                }
                disabled={answers.parties.length >= 6}
              >
                <Plus size={16} />
                הוסף משפחה
              </button>

              <div className="range-summary on" style={{ marginTop: 16 }}>
                <Users size={17} />
                <span>
                  <strong className="num">{travellers}</strong> נוסעים ב-
                  <strong className="num">{answers.parties.length}</strong>{' '}
                  {answers.parties.length === 1 ? 'משפחה' : 'משפחות'}
                </span>
              </div>
            </>
          )}

          {current.id === 'stay' && (
            <>
              <div className="row field-row" style={{ marginBottom: 12 }}>
                <Bed size={18} />
                <input
                  className="field-bare"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && findHotels()}
                  placeholder="מה חשוב לך במלון?"
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
                      const on = answers.hotel === h.name
                      return (
                        <button
                          key={h.name}
                          className={`choice ${on ? 'on' : ''}`}
                          style={{ padding: 14 }}
                          onClick={() => set({ hotel: on ? '' : h.name })}
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
            </>
          )}
        </div>
      </div>

      {/* The agent's prompt follows the question being asked. */}
      <div className="ai-overlay glass">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="ai-avatar"><Bot size={17} /></div>
          <p className="grow" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--lav)' }}>סוכן AI:</strong> {current.hint}
          </p>
        </div>
        <div className="input-wrap">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="הקלד או לחץ לדבר..."
            aria-label="הערה לסוכן"
          />
          <button
            className={`mic-btn ${listening ? 'on' : ''}`}
            onClick={() => setListening((v) => !v)}
            aria-label={listening ? 'עצור הקלטה' : 'התחל הקלטה'}
            aria-pressed={listening}
          >
            <Mic size={15} />
          </button>
        </div>
      </div>

      <div className="cta-bar">
        <button className="btn btn-primary btn-block" onClick={next} disabled={!canAdvance}>
          {step < STEPS.length - 1 ? 'הבא' : 'בוא נתחיל'}
          <ArrowLeft size={18} />
        </button>
      </div>
    </>
  )
}
