import { useEffect, useRef } from 'react'
import TopBar from '../components/TopBar'
import { AlertTriangle, Bot, Mic, Paperclip, Send, Sparkles } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { hasAI, aiMode, aiModel } from '../lib/gemini'
import { useSpeech } from '../lib/speech'
import { t } from '../i18n'

// Turns a URL inside message text into a real, clickable link. Two shapes
// show up in practice: a bare https://… (BOOKING_LINK's report line, built
// deterministically in TripProvider.jsx — never the model) and a Markdown
// [label](https://…) link (the model itself, when a Viator/Tavily result got
// folded into its context — verified live: asked despite the "no markdown"
// rule in systemPrompt, Gemini still wrapped a real Viator link that way).
// Rather than fight that instruction-following gap, both shapes are just
// handled here — whichever one shows up, it renders as a real link either
// way, no sanitizing needed beyond what React already escapes by default.
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g

function linkify(text) {
  const nodes = []
  let last = 0
  let key = 0
  LINK_RE.lastIndex = 0
  for (let m = LINK_RE.exec(text); m; m = LINK_RE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const [, label, mdUrl, bareUrl] = m
    const url = mdUrl ?? bareUrl
    nodes.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer">{label ?? url}</a>)
    last = LINK_RE.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** Openers, so an empty thread still shows what the agent is for. */
const STARTERS = [
  t('מה כדאי לעשות היום אם יורד גשם?'),
  t('תסדר לי מחדש את היום כך שנספיק הכול'),
  t('איפה כדאי לאכול ליד העצירה הבאה?'),
  t('כמה זמן ייקח להגיע בין העצירות?'),
]

/**
 * The conversation itself lives in TripProvider now, not here — switching to
 * another tab used to unmount this component and lose it entirely. This is
 * just the view onto that state.
 */
export default function Chat() {
  const {
    chatMessages: messages, chatDraft: draft, setChatDraft: setDraft,
    chatTyping: typing, chatError: error, sendChatMessage, retryChatMessage,
  } = useTrip()

  const endRef = useRef(null)
  const speech = useSpeech({ onResult: (said) => sendChatMessage(said) })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, typing])

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
                {t('סוכן פעיל')} · {aiModel}
                {aiMode === 'direct' && ` · ${t('מצב פיתוח')}`}
              </>
            ) : (
              <>
                <Bot size={12} />
                {t('הסוכן אינו מחובר')}
              </>
            )}
          </span>

          {empty && (
            <div className="chat-empty">
              <div className="ai-avatar" style={{ width: 44, height: 44, borderRadius: 14 }}>
                <Bot size={22} />
              </div>
              <h2 className="h2" style={{ marginTop: 14 }}>{t('מה תרצה לדעת?')}</h2>
              <p className="sub" style={{ marginTop: 6, maxWidth: '30ch' }}>
                {t('הסוכן מכיר את המסלול שלך — את השעות, המקומות ומי מטייל.')}
              </p>

              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} className="starter" onClick={() => sendChatMessage(s)} disabled={!hasAI}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role} msg-in`}>{linkify(m.text)}</div>
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
                <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{t('הסוכן לא הצליח לענות')}</strong>
              </div>
              <p className="tiny" style={{ margin: '0 0 12px' }}>{error}</p>
              <button className="btn btn-ghost btn-sm" onClick={retryChatMessage}>{t('נסה שוב')}</button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <div className="chat-bar glass">
        <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label={t('צרף קובץ')}>
          <Paperclip size={17} />
        </button>

        <input
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
          placeholder={speech.listening ? t('מקשיב...') : t('שאל את סוכן ה-AI...')}
          aria-label={t('הודעה')}
          disabled={!hasAI}
        />

        {speech.supported && (
          <button
            className="icon-btn"
            style={{ width: 34, height: 34, color: speech.listening ? 'var(--rose)' : undefined }}
            onClick={speech.toggle}
            aria-label={speech.listening ? t('עצור הקלטה') : t('דבר במקום להקליד')}
            aria-pressed={speech.listening}
            disabled={!hasAI}
          >
            <Mic size={17} />
          </button>
        )}

        <button className="send" onClick={() => sendChatMessage()} disabled={!draft.trim() || typing} aria-label={t('שלח')}>
          <Send size={16} />
        </button>
      </div>
    </>
  )
}
