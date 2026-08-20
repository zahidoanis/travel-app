import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import {
  AlertTriangle, Bot, Check, Mic, Paperclip, Send, Train, Plane,
} from '../components/Icons'

/** Two alternatives the agent found after the delay was detected. */
const OPTIONS = [
  {
    id: 'o1',
    title: 'אופציה מומלצת 1',
    tag: 'הכי מהיר',
    from: { time: '17:05', place: 'CDG Terminal 2' },
    to: { time: '17:42', place: 'Gare du Nord' },
    extra: 0,
  },
  {
    id: 'o2',
    title: 'אופציה 2',
    tag: 'הכי זול',
    from: { time: '17:35', place: 'CDG Terminal 1' },
    to: { time: '18:29', place: 'Gare du Nord' },
    extra: -12,
  },
]

const CANNED_REPLY =
  'אין תוספת תשלום — הכרטיס המקורי שלך גמיש והחלפתי אותו ישירות מול SNCF. ' +
  'עדכנתי גם את הלו"ז של מחר כדי שתספיק להתארגן.'

export default function Chat() {
  const [picked, setPicked] = useState('o1')
  const [approved, setApproved] = useState(false)
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [typing, setTyping] = useState(false)
  const [extra, setExtra] = useState([])
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [extra, typing, approved])

  const approve = () => {
    if (approved) return
    setApproved(true)
    setTyping(true)
    // Simulated agent turnaround.
    setTimeout(() => {
      setTyping(false)
      setExtra((m) => [
        ...m,
        { id: 'sys1', role: 'ai', text: 'מעולה, השינוי אושר. הכרטיס החדש נשלח למייל ונוסף לארנק שלך. ✅' },
      ])
    }, 1400)
  }

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setExtra((m) => [...m, { id: `u${m.length}`, role: 'me', text }])
    setTyping(true)
    setTimeout(() => {
      setTyping(false)
      setExtra((m) => [...m, { id: `a${m.length}`, role: 'ai', text: CANNED_REPLY }])
    }, 1500)
  }

  return (
    <>
      <div className="screen" style={{ paddingBottom: 150 }}>
        <TopBar />

        <div className="chat-thread">
          <span className="date-chip">היום, <span className="num">10:42</span></span>

          <div className="bubble me msg-in">
            הטיסה שלי מתעכבת בשעתיים. מה זה אומר לגבי ההזמנה של הרכבת למרכז העיר?
          </div>

          {/* System alert */}
          <div className="alert-card msg-in">
            <div className="row" style={{ marginBottom: 8 }}>
              <span style={{ color: 'var(--rose)' }}><AlertTriangle size={17} /></span>
              <strong style={{ fontSize: 14, fontWeight: 600 }}>התראת עיכוב טיסה זוהתה</strong>
            </div>
            <p className="tiny" style={{ margin: 0 }}>
              <span className="row" style={{ gap: 6, marginBottom: 4 }}>
                <Plane size={13} />
                <span>עודכנו נתוני הטיסה שלך (<span className="ltr">AF 1234</span>).</span>
              </span>
              שעת נחיתה משוערת חדשה: <strong className="num" style={{ color: 'var(--text-2)' }}>16:30</strong>
            </p>
          </div>

          {/* Agent proposal */}
          <div className="propose-card msg-in">
            <div className="row" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
              <div className="ai-avatar"><Bot size={16} /></div>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-2)' }}>
                בדקתי את הלו"ז המעודכן. הרכבת שהזמנת (<span className="ltr">RER B</span> בשעה{' '}
                <span className="num">15:15</span>) תצא לפני שתספיק לאסוף את המזוודות.
                מצאתי שתי חלופות מצוינות עבורך, האם תרצה שאאשר אחת מהן?
              </p>
            </div>

            {OPTIONS.map((o) => (
              <button
                key={o.id}
                className={`option ${picked === o.id ? 'on' : ''}`}
                onClick={() => !approved && setPicked(o.id)}
                aria-pressed={picked === o.id}
                disabled={approved}
              >
                <div className="between">
                  <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{o.title}</strong>
                  <span className="badge" style={{ padding: '3px 9px', fontSize: 10.5 }}>{o.tag}</span>
                </div>

                <div className="leg">
                  <span className="col" style={{ gap: 1 }}>
                    <strong className="num" style={{ fontSize: 13.5 }}>{o.from.time}</strong>
                    <span className="tiny ltr" style={{ fontSize: 10.5 }}>{o.from.place}</span>
                  </span>
                  <span className="leg-line" />
                  <span style={{ color: 'var(--lav)' }}><Train size={16} /></span>
                  <span className="leg-line" />
                  <span className="col" style={{ gap: 1, textAlign: 'end' }}>
                    <strong className="num" style={{ fontSize: 13.5 }}>{o.to.time}</strong>
                    <span className="tiny ltr" style={{ fontSize: 10.5 }}>{o.to.place}</span>
                  </span>
                </div>

                <span className="tiny">
                  {o.extra === 0
                    ? 'ללא תוספת תשלום'
                    : `חיסכון של ${Math.abs(o.extra)}€ לעומת ההזמנה המקורית`}
                </span>
              </button>
            ))}

            <button
              className={`btn btn-block ${approved ? 'btn-ghost' : 'btn-primary'}`}
              style={{ marginTop: 12 }}
              onClick={approve}
              disabled={approved}
            >
              {approved ? (
                <>
                  <span style={{ color: 'var(--emerald)' }}><Check size={17} /></span>
                  אושר
                </>
              ) : (
                <>
                  אשר שינוי
                  <Check size={17} />
                </>
              )}
            </button>
          </div>

          <div className="bubble me msg-in">
            כן זה מעולה. בבקשה תאשר את זה. צריך לשלם תוספת?
          </div>

          {extra.map((m) => (
            <div key={m.id} className={`bubble ${m.role} msg-in`}>{m.text}</div>
          ))}

          {typing && (
            <div className="bubble ai msg-in" style={{ padding: '10px 15px' }}>
              <span className="typing"><i /><i /><i /></span>
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="שאל את סוכן ה-AI..."
          aria-label="הודעה"
        />
        <button
          className={`icon-btn ${listening ? '' : ''}`}
          style={{ width: 34, height: 34, color: listening ? 'var(--rose)' : undefined }}
          onClick={() => setListening((v) => !v)}
          aria-label={listening ? 'עצור הקלטה' : 'הקלטה קולית'}
          aria-pressed={listening}
        >
          <Mic size={17} />
        </button>
        <button className="send" onClick={send} disabled={!draft.trim()} aria-label="שלח">
          <Send size={16} />
        </button>
      </div>
    </>
  )
}
