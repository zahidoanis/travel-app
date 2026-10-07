import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import PlaceSheet from '../components/PlaceSheet'
import PlacePhoto from '../components/PlacePhoto'
import Sheet from '../components/Sheet'
import { normaliseCategory } from '../lib/itinerary'
import { AlertTriangle, Bookmark, Bot, Link, MapPin, Mic, Plus, Send, X } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { hasAI } from '../lib/gemini'
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
//
// Every web link renders as a short labelled chip, never the raw address —
// a full Viator URL (150 characters of tracking parameters) read as noise
// on a desktop, and a tour the model wrapped as a [[place]] opened the
// map instead of the booking page on a phone.
const LINK_RE = /\[\[([^\]|]+)\|([^\]]+)\]\]|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s<>"]+)/g

const isUrl = (s) => /^https?:\/\//i.test(s)
/** Spaces cut a link in half; Viator's URLs have been seen to carry them. */
const cleanUrl = (u) => u.trim().replace(/ /g, '%20')
/** A bare URL picks up the sentence's punctuation — "(…?x=1)." */
const trimUrl = (u) => u.replace(/[).,;:!?'"»]+$/, '')

// Each pattern pins the whole registrable domain, ending at the end of the
// host. A pattern like /google\.[a-z.]+$/ accepts "google.com.evil.example"
// and labels it "Google Maps" — a convincing phishing link, and the model's
// output can be steered by web results or an imported map's text.
const COUNTRY = '[a-z]{2}'
const GOOGLE = new RegExp(`(^|\\.)google\\.(com|com\\.${COUNTRY}|co\\.${COUNTRY}|${COUNTRY})$`)

const hostOf = (href) => {
  try { return new URL(href).hostname.replace(/^www\./, '') } catch { return '' }
}

/** Where a link goes, in a few words — for a bare URL with no label. */
function linkLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (/(^|\.)viator\.com$/.test(host)) return t('הזמנה ב-Viator')
    if (GOOGLE.test(host) || host === 'maps.app.goo.gl') return 'Google Maps'
    return host
  } catch {
    return t('קישור')
  }
}

/** `named`: the label is the model's own words, so the real host follows
 *  it — "[Booking.com](evil.example)" used to show only "Booking.com". */
function ExtLink({ url, label, named = false }) {
  const host = named ? hostOf(url) : ''
  return (
    <a className="ext-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
      <Link size={12} />
      {label}
      {host && !label.toLowerCase().includes(host.toLowerCase()) ? <span className="link-host"> ({host})</span> : null}
    </a>
  )
}

function linkify(text, onPlace) {
  const nodes = []
  let last = 0
  let key = 0
  LINK_RE.lastIndex = 0
  for (let m = LINK_RE.exec(text); m; m = LINK_RE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const [, placeLabel, placeQuery, label, mdUrl, bareUrl] = m
    if (placeLabel && isUrl(placeQuery.trim())) {
      // A bookable tour written in place syntax — it's a link, not a pin.
      nodes.push(<ExtLink key={key++} url={cleanUrl(placeQuery)} label={placeLabel.trim()} named />)
    } else if (placeLabel) {
      const place = { label: placeLabel.trim(), query: placeQuery.trim() }
      nodes.push(
        <button key={key++} className="place-link" onClick={() => onPlace(place)}>
          <MapPin size={12} />{place.label}
        </button>
      )
    } else if (mdUrl) {
      nodes.push(<ExtLink key={key++} url={cleanUrl(mdUrl)} label={label.trim()} named />)
    } else {
      const url = trimUrl(bareUrl)
      nodes.push(<ExtLink key={key++} url={url} label={linkLabel(url)} />)
      if (bareUrl.length > url.length) nodes.push(bareUrl.slice(url.length))
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
    if (isUrl(place.query)) continue // a tour's booking link, not a place
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

/** Where TripProvider appends "📌 saved to memory: …" to a reply. */
const MEMORY_NOTE = /\s*📌\s*/

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
  const scroller = useRef(null)
  const speech = useSpeech({ onResult: (said) => sendChatMessage(said) })

  // Follows the conversation down as it grows — unless the reader has
  // scrolled up to re-read something, in which case a new chunk of a reply
  // must not yank them back. "Near the bottom" is judged from where they
  // last left the scroll, before the new content arrived.
  //
  // This used to be scrollIntoView() on a marker after the last message,
  // which lined the marker up with the bottom edge of the screen — behind
  // the input bar and the nav that float over it — so the newest lines and
  // the suggestion buttons always sat hidden underneath them.
  const pinned = useRef(true)
  const onScroll = (e) => {
    const el = e.currentTarget
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  const lastMine = messages.at(-1)?.role === 'me'
  useEffect(() => {
    const el = scroller.current
    if (!el || !(pinned.current || lastMine)) return
    // Instant while a reply streams in (smooth scrolling on every chunk
    // stutters), smooth for a message arriving whole.
    const streamingNow = messages.at(-1)?.streaming
    el.scrollTo({ top: el.scrollHeight, behavior: streamingNow ? 'auto' : 'smooth' })
    pinned.current = true
  }, [messages, typing, lastMine])

  // Opening the chat lands on the latest message, not the top of the thread.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

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
      <div className="screen chat-screen" ref={scroller} onScroll={onScroll}>
        <TopBar />

        <div className="chat-thread">
          {/* Only when something is wrong — "active · gemini-3.6-flash" was a
              developer's readout, meaningless to a traveller. */}
          {!hasAI && (
            <span className="ai-status">
              <Bot size={12} />
              {t('הסוכן אינו מחובר')}
            </span>
          )}

          {/* The note in a reply opens this too, but only in the session it
              was written in — after a reload, this was the only way left to
              see or delete what the agent remembers. */}
          {memory.length > 0 && (
            <button className="ai-status" onClick={() => setMemoryOpen(true)}>
              <Bookmark size={12} />
              {t('מה הסוכן זוכר ({n})', { n: memory.length })}
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
              <div className={`bubble ${m.role} msg-in`}>
                {linkify(m.role === 'ai' ? m.text.split(MEMORY_NOTE)[0] : m.text, setPlace)}
                {/* The "saved to memory" note is the way into the memory list —
                    it appears exactly when memory becomes relevant, instead of
                    a permanent button at the top of the chat. */}
                {m.role === 'ai' && MEMORY_NOTE.test(m.text) && (
                  <button className="memory-note" onClick={() => setMemoryOpen(true)}>
                    <Bookmark size={12} />
                    <span>{m.text.split(MEMORY_NOTE)[1]}</span>
                  </button>
                )}
              </div>
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

          {/* Why the microphone did nothing — blocked, offline, unsupported.
              The hook always knew; nothing showed it, so a blocked mic was
              just a button that did not work. */}
          {speech.error && (
            <p className="tiny msg-in" role="alert" style={{ color: 'var(--rose)' }}>{speech.error}</p>
          )}

        </div>
      </div>

      <div className="chat-bar glass">
        {/* The paperclip that sat here attached nothing — a button that
            does nothing reads as broken, so it's gone until attaching is real. */}
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
