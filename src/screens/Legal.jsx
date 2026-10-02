import { lazy, Suspense, useEffect, useRef } from 'react'
import { ArrowRight } from '../components/Icons'
import ErrorBoundary from '../components/ErrorBoundary'
import LangToggle from '../components/LangToggle'
import { LegalLink } from '../legal/parts'
import { LEGAL_DOCS, closeLegal } from '../legal/route'
import { LAST_UPDATED } from '../legal/operator'
import { t, lang, dir, locale } from '../i18n'

const TITLES = {
  privacy: t('מדיניות פרטיות'),
  terms: t('תנאי שימוש'),
  accessibility: t('הצהרת נגישות'),
}

// The documents are long and almost nobody opens them, so each one is its
// own chunk, in the one language this page load is running in.
const SOURCES = {
  privacy: { he: () => import('../legal/privacy.he.jsx'), en: () => import('../legal/privacy.en.jsx') },
  terms: { he: () => import('../legal/terms.he.jsx'), en: () => import('../legal/terms.en.jsx') },
  accessibility: {
    he: () => import('../legal/accessibility.he.jsx'),
    en: () => import('../legal/accessibility.en.jsx'),
  },
}
const BODIES = Object.fromEntries(LEGAL_DOCS.map((doc) => [doc, lazy(SOURCES[doc][lang])]))

/**
 * The privacy policy, the terms and the accessibility statement.
 *
 * Deliberately outside the app shell: a reading page wants a wide column and
 * its own scroll, and it has to work for someone who has never opened the
 * app — it needs no trip, no account and no network beyond its own chunk.
 */
export default function Legal({ doc }) {
  const Body = BODIES[doc]
  const scroller = useRef(null)
  const heading = useRef(null)

  useEffect(() => {
    const previous = document.title
    document.title = `${TITLES[doc]} — TripAI`
    scroller.current?.scrollTo(0, 0)
    // Announces the new page to a screen reader and puts keyboard focus at
    // the top of it, the way a real page load would.
    heading.current?.focus()
    return () => { document.title = previous }
  }, [doc])

  const updated = new Date(LAST_UPDATED).toLocaleDateString(locale, {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="legal" dir={dir} ref={scroller}>
      <header className="legal-bar">
        <button className="btn btn-ghost btn-sm" onClick={closeLegal}>
          <ArrowRight size={16} />
          {t('חזרה לאפליקציה')}
        </button>
        <LangToggle compact />
      </header>

      <nav className="legal-tabs" aria-label={t('מסמכים משפטיים')}>
        {LEGAL_DOCS.map((id) => (
          <LegalLink key={id} doc={id} className={id === doc ? 'on' : ''} aria-current={id === doc ? 'page' : undefined}>
            {TITLES[id]}
          </LegalLink>
        ))}
      </nav>

      <main className="legal-doc">
        <h1 tabIndex={-1} ref={heading}>{TITLES[doc]}</h1>
        <p className="legal-updated">{t('עודכן לאחרונה: {date}', { date: updated })}</p>
        <ErrorBoundary scope={`legal-${doc}`} key={doc}>
          <Suspense fallback={<p className="legal-loading"><span className="typing"><i /><i /><i /></span></p>}>
            <Body />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}
