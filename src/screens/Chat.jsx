import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import PlaceSheet from '../components/PlaceSheet'
import PlacePhoto from '../components/PlacePhoto'
import Sheet from '../components/Sheet'
import { normaliseCategory } from '../lib/itinerary'
import { AlertTriangle, Bookmark, Bot, MapPin, Mic, Paperclip, Plus, Send, Sparkles, X } from '../components/Icons'
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
//
// A third shape is the agent's own place markup, [[shown name|Place, City,
// Country]] (see systemPrompt): it becomes a button that opens the place on
// a map, ready to add to a day.
const LINK_RE = /\[\[([^\]|]+)\|([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s]+)/g

function linkify(text, onPlace) {
  const nodes = []
  let last = 0
  let key = 0
  LINK_RE.lastIndex = 0
  for (let m = LINK_RE.exec(text); m; m = LINK_RE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const [, placeLabel, placeQuery, label, mdUrl, bareUrl] = m
    if (placeLabel) {
      const place = { label: placeLabel.trim(), query: placeQuery.trim() }
      nodes.push(
        <button key={key++} className="place-link" onClick={() => onPlace(place)}>
          <MapPin size={12} />{place.label}
        </button>
      )
    } else {
      const url = mdUrl ?? bareUrl
      nodes.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer">{label ?? url}</a>)
    }
    last = LINK_RE.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/**
 * The places a reply named, as cards with a photo under the bubble — the
 * inline links stay too, this is the at-a-glance version. Photos come from
 * Wikipedia, so landmarks get one and most restaurants keep the tinted
 * placeholder; either way the card opens PlaceSheet to add it to a day.
 */
function PlaceCards({ text, onOpen }) {
  const places = []
  for (const m of text.matchAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g)) {
    const place = { label: m[1].trim(), query: m[2].trim() }
    if (!places.some((p) => p.query === place.query)) places.push(place)
  }
  if (places.length === 0) return null
  return (
    <div className="place-cards msg-in">
      {places.slice(0, 4).map((p) => (
        <button key={p.query} className="place-card" onClick={() => onOpen(p)}>
          <PlacePhoto name={p.query} cat={normaliseCategory(`${p.label} ${p.query}`)} className="place-card-img" />
          <span className="place-card-body">
            <strong>{p.label}</strong>
            <span className="place-card-add"><Plus size={12} /> {t('הוסף ליום')}</span>
          </span>
        </button>
      ))}
    </div>
  )
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
    openChat, trip, forgetMemory,
  } = useTrip()

  const [place, setPlace] = useState(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const memory = trip?.memory ?? []

  // The agent opens the conversation itself — once per trip per session;
  // openChat() is a no-op on a thread that already has anything in it.
  useEffect(() => { openChat() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const endRef = useRef(null)
  const speech = useSpeech({ onResult: (said) => sendChatMessage(said) })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, typing])

  const shown = speech.listening && speech.interim ? speech.interim : draft
  // The opener's prompt is a hidden user turn — part of the history the
  // agent sees, never drawn.
  const visible = messages.filter((m) => !m.hidden)
  const empty = visible.length === 0 && !typing
  const last = visible.at(-1)
  // Dots only until the first words arrive; after that the reply itself is
  // what's moving.
  const waiting = typing && !(last?.role === 'ai' && last.streaming)

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

          {hasAI && (
            <button className="memory-chip" onClick={() => setMemoryOpen(true)}>
              <Bookmark size={12} />
              {memory.length > 0
                ? t('הסוכן זוכר {n} דברים עליכם', { n: memory.length })
                : t('מה הסוכן זוכר עליכם')}
            </button>
          )}

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

          {visible.map((m) => (
            <div key={m.id} style={{ display: 'contents' }}>
              <div className={`bubble ${m.role} msg-in`}>{linkify(m.text, setPlace)}</div>
              {m.role === 'ai' && !m.streaming && <PlaceCards text={m.text} onOpen={setPlace} />}
              {/* Only the latest reply's follow-ups — older ones answer a
                  moment in the conversation that has already passed. */}
              {m.role === 'ai' && m === last && !typing && m.suggestions?.length > 0 && (
                <div className="chat-suggest msg-in">
                  {m.suggestions.map((s) => (
                    <button key={s} className="starter" onClick={() => sendChatMessage(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {waiting && (
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

      <PlaceSheet place={place} onClose={() => setPlace(null)} />

      <Sheet open={memoryOpen} onClose={() => setMemoryOpen(false)} title={t('מה הסוכן זוכר')}>
        <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
          {t('דברים שסיפרתם בשיחה — הסוכן מתחשב בהם בכל המלצה ובכל יום שהוא בונה. כל מי שבטיול רואה אותם.')}
        </p>
        {memory.length === 0 ? (
          <p className="tiny">{t('עדיין כלום. ספרו לסוכן למשל שאתם צמחוניים, או מה גילאי הילדים, והוא יזכור.')}</p>
        ) : (
          <ul className="memory-list">
            {memory.map((m) => (
              <li key={m.id} className="card row">
                <span className="grow">{m.text}</span>
                <button className="icon-btn" onClick={() => forgetMemory(m.id)} aria-label={t('שכח את זה')}>
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </>
  )
}
