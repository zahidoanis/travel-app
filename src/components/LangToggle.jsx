import { useEffect, useRef, useState } from 'react'
import { LANGS, lang, setLang, t } from '../i18n'

/**
 * The language menu: the current language as a flag and a name, opening a
 * short list to choose from.
 *
 * It used to be a single button that switched (and reloaded) on the first
 * tap, labelled with the *other* language — easy to hit by accident, and it
 * never showed which language you were in. Each language is named in itself
 * ("עברית", "English") so it can be found by someone who can't read the
 * current one.
 *
 * `compact` is the top-bar form: flag and a two-letter code.
 */
const OPTIONS = {
  he: { name: 'עברית', short: 'עב', Flag: FlagIL }, // i18n-ignore
  en: { name: 'English', short: 'EN', Flag: FlagUS },
}

export default function LangToggle({ className = '', compact = false }) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const root = useRef(null)
  const current = OPTIONS[lang]

  // Closes on a tap anywhere else and on Escape, and hands focus back to the
  // button it came from.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!root.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      root.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const toggle = () => {
    // Opens upward when there is no room below (the bottom of a sheet).
    const rect = root.current?.getBoundingClientRect()
    setAbove(Boolean(rect) && window.innerHeight - rect.bottom < 130)
    setOpen((o) => !o)
  }

  const choose = (next) => {
    setOpen(false)
    setLang(next) // reloads into it; nothing happens when it is already current
  }

  return (
    <div className={`lang-menu ${className}`} ref={root}>
      <button
        type="button"
        className={`lang-toggle ${compact ? 'compact' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('שפה: {name}', { name: current.name })}
      >
        <current.Flag />
        {compact ? current.short : current.name}
        <span className="lang-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={`lang-list ${above ? 'above' : ''}`} role="menu">
          {LANGS.map((code) => {
            const o = OPTIONS[code]
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={code === lang}
                lang={code}
                className={`lang-item ${code === lang ? 'on' : ''}`}
                onClick={() => choose(code)}
                autoFocus={code === lang}
              >
                <o.Flag />
                <span className="grow">{o.name}</span>
                {code === lang && <span aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* Flags are drawn here rather than as emoji: Windows has no flag emoji at
   all and shows the bare letters "IL" / "US" instead. */
function FlagIL() {
  return (
    <svg className="flag" viewBox="0 0 22 16" aria-hidden="true">
      <rect width="22" height="16" rx="2" fill="#fff" />
      <rect y="1.6" width="22" height="2.3" fill="#0038B8" />
      <rect y="12.1" width="22" height="2.3" fill="#0038B8" />
      <g fill="none" stroke="#0038B8" strokeWidth="0.9">
        <path d="M11 4.7 13.7 9.4H8.3Z" />
        <path d="M11 11.3 8.3 6.6H13.7Z" />
      </g>
      <rect width="22" height="16" rx="2" fill="none" stroke="rgba(0,0,0,0.12)" />
    </svg>
  )
}

function FlagUS() {
  return (
    <svg className="flag" viewBox="0 0 22 16" aria-hidden="true">
      <rect width="22" height="16" rx="2" fill="#fff" />
      {/* Seven red stripes of thirteen. */}
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 16) / 13} width="22" height={16 / 13} fill="#B22234" />
      ))}
      <rect width="9.5" height={(16 / 13) * 7} fill="#3C3B6E" />
      <rect width="22" height="16" rx="2" fill="none" stroke="rgba(0,0,0,0.12)" />
    </svg>
  )
}
