import { lang, setLang } from '../i18n'

/**
 * Switches the UI between Hebrew and English (reloads — see i18n.js).
 * Always labelled with the *other* language's own name, in that language,
 * so it's findable by someone who can't read the current one.
 *
 * `compact` is the top-bar form: a short code instead of the full name,
 * so it fits beside the other top-bar buttons on every screen.
 */
export default function LangToggle({ className = '', compact = false }) {
  const other = lang === 'he' ? 'en' : 'he'
  const full = other === 'en' ? 'English' : 'עברית' // i18n-ignore
  const short = other === 'en' ? 'EN' : 'עב' // i18n-ignore
  return (
    <button
      type="button"
      className={`lang-toggle ${compact ? 'compact' : ''} ${className}`}
      onClick={() => setLang(other)}
      lang={other}
      aria-label={other === 'en' ? 'Switch to English' : 'החלף לעברית'} // i18n-ignore
      title={full}
    >
      <span aria-hidden="true">🌐</span>
      {compact ? short : full}
    </button>
  )
}
