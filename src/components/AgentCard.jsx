import { useRef, useState } from 'react'
import { Bot, Mic, Send, X, MapPin, Check } from './Icons'
import { hasAI, complete, parseRows } from '../lib/gemini'
import { useSpeech } from '../lib/speech'
import { breadcrumb, watchdog } from '../lib/telemetry'

/**
 * The onboarding agent. Previously this was a dead input: it collected text
 * that was only read at the very end, had no submit affordance, and a mic
 * button that toggled a colour and nothing else.
 *
 * `onPick` lets a step accept a structured answer — the destination question
 * turns replies into chips you can tap, rather than prose you have to retype.
 */
export default function AgentCard({ step, context, hint, onPick }) {
  const [text, setText] = useState('')
  const [reply, setReply] = useState('')
  const [picks, setPicks] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const speech = useSpeech({
    onResult: (said) => {
      setText(said)
      // Dictation is a complete thought — send it rather than making the user
      // find the button afterwards.
      ask(said)
    },
  })

  const wantsPicks = step === 'where' && Boolean(onPick)

  const ask = async (override) => {
    const q = (override ?? text).trim()
    if (!q || busy || !hasAI) return

    breadcrumb('action', `agent asked on step ${step}`)
    setBusy(true)
    setError(null)
    setReply('')
    setPicks([])
    const done = watchdog('agent.ask', 25000, { step })

    try {
      const answer = await complete({
        system: wantsPicks
          ? 'אתה סוכן נסיעות. המלץ על יעדים. החזר אך ורק שורות בפורמט: ' +
            'עיר בעברית | מדינה בעברית | משפט אחד קצר למה מתאים. ' +
            'בלי כותרות, בלי מספור, בלי טקסט נוסף. בדיוק 4 שורות.'
          : 'אתה סוכן הנסיעות של TripAI. ענה בעברית, קצר — 2-3 משפטים לכל היותר. ' +
            'אל תמציא מחירים או שעות פתיחה. אם חסר לך מידע, אמור מה חסר.',
        prompt: `${context}\n\nהמשתמש שואל: ${q}`,
      })

      if (wantsPicks) {
        const rows = parseRows(answer, ['city', 'country', 'why'])
        if (rows.length > 0) setPicks(rows)
        else setReply(answer)
      } else {
        setReply(answer)
      }
      setText('')
    } catch (err) {
      setError(err.message)
    } finally {
      done()
      setBusy(false)
    }
  }

  const clear = () => {
    setReply('')
    setPicks([])
    setError(null)
    inputRef.current?.focus()
  }

  const shown = speech.listening && speech.interim ? speech.interim : text

  return (
    <div className="ai-overlay glass">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="ai-avatar"><Bot size={17} /></div>
        <p className="grow agent-hint">
          <strong>סוכן AI:</strong> {hasAI ? hint : 'הסוכן אינו מחובר כרגע.'}
        </p>
        {(reply || picks.length > 0) && (
          <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={clear} aria-label="נקה">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Suggestions the step can accept directly */}
      {picks.length > 0 && (
        <div className="col agent-picks">
          {picks.map((p) => (
            <button key={`${p.city}${p.country}`} className="agent-pick" onClick={() => onPick(p)}>
              <MapPin size={14} />
              <span className="grow">
                <strong>{p.city}</strong>
                <span className="tiny">{p.country} · {p.why}</span>
              </span>
              <Check size={14} />
            </button>
          ))}
        </div>
      )}

      {reply && <p className="agent-reply">{reply}</p>}
      {error && <p className="agent-reply" style={{ color: 'var(--rose)' }}>{error}</p>}

      <div className="input-wrap">
        <input
          ref={inputRef}
          value={shown}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask()
            }
          }}
          placeholder={
            speech.listening ? 'מקשיב...' : hasAI ? 'שאל אותי כל דבר...' : 'הסוכן אינו מחובר'
          }
          aria-label="שאלה לסוכן"
          disabled={!hasAI || busy}
        />

        {busy ? (
          <span className="typing"><i /><i /><i /></span>
        ) : (
          <>
            {/* Hidden where the browser has no recogniser, rather than
                offering a button that silently does nothing. */}
            {speech.supported && (
              <button
                className={`mic-btn ${speech.listening ? 'on' : ''}`}
                onClick={speech.toggle}
                aria-label={speech.listening ? 'עצור הקלטה' : 'דבר במקום להקליד'}
                aria-pressed={speech.listening}
                disabled={!hasAI}
              >
                <Mic size={15} />
              </button>
            )}
            <button
              className="agent-send"
              onClick={() => ask()}
              disabled={!hasAI || !text.trim()}
              aria-label="שלח לסוכן"
            >
              <Send size={15} />
            </button>
          </>
        )}
      </div>

      {speech.error && <p className="tiny" style={{ marginTop: 8, color: 'var(--rose)' }}>{speech.error}</p>}
    </div>
  )
}
