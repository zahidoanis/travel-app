import { useEffect, useId, useRef, useState } from 'react'
import { lang, setLang } from '../i18n'

/**
 * Flags drawn as SVG, not emoji: Windows renders 🇮🇱/🇬🇧 as the bare letters
 * "IL"/"GB", so an emoji flag would show up as two letters on most desktops.
 * Both are cropped into the same 3:2 box so they line up in a list.
 */
function FlagIL() {
  return (
    <svg className="flag" viewBox="0 0 220 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="220" height="160" fill="#fff" />
      <rect y="15" width="220" height="25" fill="#0038B8" />
      <rect y="120" width="220" height="25" fill="#0038B8" />
      <g fill="none" stroke="#0038B8" strokeWidth="5.5">
        <path d="M110 47 138.6 96.5H81.4Z" />
        <path d="M110 113 81.4 63.5H138.6Z" />
      </g>
    </svg>
  )
}

function FlagGB() {
  // Clip-path ids must be unique per document — two pickers can be on screen.
  const id = useId().replace(/:/g, '')
  return (
    <svg className="flag" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <clipPath id={`gb-s-${id}`}><path d="M0 0v30h60V0z" /></clipPath>
      <clipPath id={`gb-t-${id}`}><path d="M30 15h30v15zv15H0zH0V0zV0h30z" /></clipPath>
      <g clipPath={`url(#gb-s-${id})`}>
        <path d="M0 0v30h60V0z" fill="#012169" />
        <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6" />
        <path d="M0 0l60 30m0-30L0 30" clipPath={`url(#gb-t-${id})`} stroke="#C8102E" strokeWidth="4" />
        <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10" />
        <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  )
}

// Each language named in itself, so it's findable by someone who can't read
// the current UI language.
const OPTIONS = [
  { id: 'he', name: 'עברית', Flag: FlagIL }, // i18n-ignore
  { id: 'en', name: 'English', Flag: FlagGB },
]

/**
 * The language picker: the current language's flag, opening a short menu of
 * the languages on offer — each with its flag and its own name. Choosing one
 * reloads into it (see i18n.js).
 *
 * `compact` is the top-bar form (flag only); `up` opens the menu upward, for
 * the copy at the bottom of the account sheet.
 */
export default function LangToggle({ className = '', compact = false, up = false }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const current = OPTIONS.find((o) => o.id === lang) ?? OPTIONS[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    // Escape closes this menu only — not the sheet it may be sitting in —
    // and hands focus back to the button it came from.
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      box.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className={`lang-picker ${className}`} ref={box}>
      <button
        type="button"
        className={`lang-toggle ${compact ? 'compact' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={lang === 'he' ? 'שפה: עברית. בחר שפה' : 'Language: English. Choose a language'} // i18n-ignore
      >
        <current.Flag />
        {!compact && <span>{current.name}</span>}
        <svg className="lang-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <ul className={`lang-menu ${up ? 'up' : ''}`} role="menu">
          {OPTIONS.map(({ id, name, Flag }) => (
            <li key={id} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={id === lang}
                lang={id}
                dir={id === 'he' ? 'rtl' : 'ltr'}
                className={id === lang ? 'on' : ''}
                onClick={() => { setOpen(false); setLang(id) }}
              >
                <Flag />
                <span className="grow">{name}</span>
                {id === lang && (
                  <svg className="lang-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
