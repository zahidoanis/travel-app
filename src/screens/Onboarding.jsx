import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Mic, Bot } from '../components/Icons'
import { TRAVEL_STYLES, BUDGETS } from '../data'

const STEPS = 3

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(1)
  const [styles, setStyles] = useState(['chill'])
  const [budget, setBudget] = useState('mid')
  const [prompt, setPrompt] = useState('')
  const [listening, setListening] = useState(false)

  const toggleStyle = (id) =>
    setStyles((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const next = () =>
    step < STEPS ? setStep(step + 1) : onDone({ styles, budget, note: prompt.trim() })
  const back = () => (step > 1 ? setStep(step - 1) : null)

  return (
    <>
      <div className="screen" style={{ paddingBottom: 200 }}>
        <header className="pad" style={{ paddingTop: 18 }}>
          <div className="between" style={{ marginBottom: 14 }}>
            <button className="icon-btn" onClick={back} aria-label="חזור" disabled={step === 1}>
              <ArrowRight size={20} />
            </button>
            <span className="tiny" style={{ fontWeight: 500 }}>
              שלב <span className="num">{step}</span> מתוך <span className="num">{STEPS}</span>
            </span>
          </div>
          <div className="progress">
            <i style={{ width: `${(step / STEPS) * 100}%` }} />
          </div>
        </header>

        <div className="pad" style={{ marginTop: 26 }}>
          <h1 className="h1">ספר לנו על הטיול שלך</h1>
          <p className="sub" style={{ marginTop: 10 }}>
            כדי שנוכל להתאים את החוויה המושלמת עבורך, נשמח להכיר את סגנון הטיול המועדף עליך.
          </p>

          <h2 className="h2" style={{ margin: '26px 0 12px' }}>סגנון טיול</h2>
          <div className="choice-grid">
            {TRAVEL_STYLES.map((s, i) => {
              const on = styles.includes(s.id)
              // The third style card runs full width, as in the design.
              const wide = i === 2
              return (
                <button
                  key={s.id}
                  className={`choice ${on ? 'on' : ''} ${wide ? 'wide' : ''}`}
                  onClick={() => toggleStyle(s.id)}
                  aria-pressed={on}
                >
                  <span className="radio">{on && <Check size={11} />}</span>
                  <span className="choice-icon" aria-hidden="true">{s.emoji}</span>
                  <span>
                    <span className="choice-title" style={wide ? { marginTop: 0 } : undefined}>
                      {s.title}
                    </span>
                    <span className="choice-sub">{s.sub}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <h2 className="h2" style={{ margin: '26px 0 12px' }}>תקציב יומי</h2>
          <div className="pills">
            {BUDGETS.map((b) => (
              <button
                key={b.id}
                className={`pill ${budget === b.id ? 'on' : ''}`}
                onClick={() => setBudget(b.id)}
                aria-pressed={budget === b.id}
              >
                {b.label}
              </button>
            ))}
          </div>

          {/* Spacer so the floating AI card never covers the last pills. */}
          <div style={{ height: 150 }} />
        </div>
      </div>

      {/* Floating AI agent overlay */}
      <div className="ai-overlay glass">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="ai-avatar"><Bot size={17} /></div>
          <p className="grow" style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--lav)' }}>סוכן AI:</strong>{' '}
            רוצה לפרט יותר על חופשת החלומות שלך? אני כאן כדי להקשיב.
          </p>
        </div>
        <div className="input-wrap">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="הקלד או לחץ לדבר..."
            aria-label="תיאור חופשת החלומות"
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
        <button className="btn btn-primary btn-block" onClick={next}>
          {step < STEPS ? 'הבא' : 'בוא נתחיל'}
          <ArrowLeft size={18} />
        </button>
      </div>
    </>
  )
}
