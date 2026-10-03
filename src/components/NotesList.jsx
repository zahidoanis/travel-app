import { useState } from 'react'
import { Check, Copy, Pencil } from './Icons'
import { copyText } from '../lib/share'
import { t, locale } from '../i18n'

/**
 * The trip's notes — a driver's phone number, a door code, a booking number.
 *
 * Each used to be one big button in small grey print: the line breaks were
 * lost, a phone number inside could not be called, a link could not be
 * opened (a link cannot sit inside a button), and copying a code meant
 * opening the editor and selecting text in it. Now the text is the content,
 * at reading size, with its numbers and links live, a copy button for the
 * code you are about to type somewhere else, and who wrote it and when.
 */

// A phone number (7+ digits, with the usual separators) or a web address.
const LIVE = /(https?:\/\/[^\s]+[^\s.,;:!?)\]'"])|(\+?\d[\d\s\-–]{6,}\d)/g

function liveText(text) {
  const out = []
  let last = 0
  let key = 0
  LIVE.lastIndex = 0
  for (let m = LIVE.exec(text); m; m = LIVE.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const [match, url, phone] = m
    if (url) {
      let label = url
      try { label = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep the raw text */ }
      out.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a>)
    } else if (phone.replace(/\D/g, '').length >= 7) {
      out.push(<a key={key++} href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="ltr">{phone}</a>)
    } else {
      out.push(match)
    }
    last = LIVE.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const when = (ms) =>
  new Date(ms).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function NotesList({ notes, onEdit }) {
  const [copied, setCopied] = useState(null)

  const copy = async (n) => {
    if (!(await copyText(n.text))) return
    setCopied(n.id)
    setTimeout(() => setCopied((c) => (c === n.id ? null : c)), 1500)
  }

  return (
    <ul className="card notes-list">
      {notes.map((n) => {
        const meta = [n.at ? when(n.editedAt ?? n.at) : null, n.by].filter(Boolean).join(' · ')
        return (
          <li key={n.id} className="note-item">
            <p className="note-text">{liveText(n.text)}</p>
            <div className="note-foot">
              <span className="tiny">{meta}</span>
              <span className="row" style={{ gap: 2 }}>
                <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => copy(n)} aria-label={t('העתק את ההערה')}>
                  {copied === n.id ? <Check size={15} /> : <Copy size={15} />}
                </button>
                {onEdit && (
                  <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => onEdit(n)} aria-label={t('ערוך הערה')}>
                    <Pencil size={15} />
                  </button>
                )}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
