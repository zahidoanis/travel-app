import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import { AlertTriangle, Bot, Mic, Paperclip, Send, Sparkles } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { hasAI, aiMode, aiModel, systemPrompt, streamReply } from '../lib/gemini'
import { useSpeech } from '../lib/speech'
import { breadcrumb } from '../lib/telemetry'

/** Openers, so an empty thread still shows what the agent is for. */
const STARTERS = [
  'מה כדאי לעשות היום אם יורד גשם?',
  'תסדר לי מחדש את היום כך שנספיק הכול',
  'איפה כדאי לאכול ליד העצירה הבאה?',
  'כמה זמן ייקח להגיע בין העצירות?',
]

export default function Chat() {
  const { trip, stops, families } = useTrip()

  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState(null)
  const endRef = useRef(null)
  const abortRef = useRef(null)

  const speech = useSpeech({ onResult: (said) => send(said) })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, typing])

  // A stream left running after the screen unmounts keeps writing into state.
  useEffect(() => () => abortRef.current?.abort(), [])

  const system = systemPrompt({ trip, stops, families })

  const ask = async (history) => {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setTyping(true)

    const id = `a${Date.now()}`
    let started = false

    try {
      await streamReply({
        messages: history,
        system,
        signal: controller.signal,
        onChunk: (delta) => {
          if (!started) {
            started = true
            setTyping(false)
            setMessages((m) => [...m, { id, role: 'ai', text: delta }])
            return
          }
          setMessages((m) => m.map((x) => (x.id === id ? { ...x, text: x.text + delta } : x)))
        },
      })
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message)
    } finally {
      setTyping(false)
      abortRef.current = null
    }
  }

  const send = (override) => {
    const text = (override ?? draft).trim()
    if (!text || typing) return

    breadcrumb('action', 'chat message sent')
    setDraft('')

    const mine = { id: `u${Date.now()}`, role: 'me', text }
    const history = [...messages, mine]
    setMessages(history)

    if (hasAI) ask(history)
    else setError('הסוכן אינו מחובר כרגע.')
  }

  /** Re-runs the last question, dropping the failed exchange. */
  const retry = () => {
    const lastMine = [...messages].reverse().find((m) => m.role === 'me')
    if (!lastMine) return
    const upTo = messages.slice(0, messages.lastIndexOf(lastMine) + 1)
    setMessages(upTo)
    ask(upTo)
  }

  const shown = speech.listening && speech.interim ? speech.interim : draft
  const empty = messages.length === 0

  return (
    <>
      <div className="screen" style={{ paddingBottom: 150 }}>
        <TopBar />

        <div className="chat-thread">
          <span className={`ai-status ${hasAI ? 'live' : ''}`}>
            {hasAI ? (
              <>
                <Sparkles size={12} />
                סוכן פעיל · {aiModel}
                {aiMode === 'direct' && ' · מצב פיתוח'}
              </>
            ) : (
              <>
                <Bot size={12} />
                הסוכן אינו מחובר
              </>
            )}
          </span>

          {empty && (
            <div className="chat-empty">
              <div className="ai-avatar" style={{ width: 44, height: 44, borderRadius: 14 }}>
                <Bot size={22} />
              </div>
              <h2 className="h2" style={{ marginTop: 14 }}>מה תרצה לדעת?</h2>
              <p className="sub" style={{ marginTop: 6, maxWidth: '30ch' }}>
                הסוכן מכיר את המסלול שלך{trip ? ` ב${trip.city}` : ''} — את השעות, המקומות ומי מטייל.
              </p>

              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} className="starter" onClick={() => send(s)} disabled={!hasAI}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role} msg-in`}>{m.text}</div>
          ))}

          {typing && (
            <div className="bubble ai msg-in" style={{ padding: '10px 15px' }}>
              <span className="typing"><i /><i /><i /></span>
            </div>
          )}

          {error && (
            <div className="alert-card msg-in">
              <div className="row" style={{ marginBottom: 8 }}>
                <span style={{ color: 'var(--rose)' }}><AlertTriangle size={16} /></span>
                <strong style={{ fontSize: 13.5, fontWeight: 600 }}>הסוכן לא הצליח לענות</strong>
              </div>
              <p className="tiny" style={{ margin: '0 0 12px' }}>{error}</p>
              <button className="btn btn-ghost btn-sm" onClick={retry}>נסה שוב</button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <div className="chat-bar glass">
        <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="צרף קובץ">
          <Paperclip size={17} />
        </button>

        <input
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={speech.listening ? 'מקשיב...' : 'שאל את סוכן ה-AI...'}
          aria-label="הודעה"
          disabled={!hasAI}
        />

        {speech.supported && (
          <button
            className="icon-btn"
            style={{ width: 34, height: 34, color: speech.listening ? 'var(--rose)' : undefined }}
            onClick={speech.toggle}
            aria-label={speech.listening ? 'עצור הקלטה' : 'דבר במקום להקליד'}
            aria-pressed={speech.listening}
            disabled={!hasAI}
          >
            <Mic size={17} />
          </button>
        )}

        <button className="send" onClick={() => send()} disabled={!draft.trim() || typing} aria-label="שלח">
          <Send size={16} />
        </button>
      </div>
    </>
  )
}
