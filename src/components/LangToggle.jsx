import { lang, setLang } from '../i18n'

/**
 * Switches the UI between Hebrew and English (reloads — see i18n.js).
 * Always labelled with the *other* language's own name, in that language,
 * so it's findable by someone who can't read the current one.
 */
export default function LangToggle({ className = '' }) {
  const other = lang === 'he' ? 'en' : 'he'
  return (
    <button
      type="button"
      className={`lang-toggle ${className}`}
      onClick={() => setLang(other)}
      lang={other}
      aria-label={other === 'en' ? 'Switch to English' : 'החלף לעברית'} // i18n-ignore
    >
      <span aria-hidden="true">🌐</span>
      {other === 'en' ? 'English' : 'עברית' /* i18n-ignore */}
    </button>
  )
}
