/**
 * Routing for the legal pages — /privacy, /terms, /accessibility.
 *
 * The app has no router: screens are tabs held in state. These three are the
 * exception because each needs an address of its own — Google's sign-in
 * consent screen links to the privacy policy and the terms by URL, and an
 * accessibility statement has to be reachable without first getting through
 * onboarding. Firebase Hosting already rewrites every path to index.html, so
 * the paths only have to be recognised here.
 */
import { useEffect, useState } from 'react'

export const LEGAL_DOCS = ['privacy', 'terms', 'accessibility']

const ROUTE_EVENT = 'tripai:route'

export const legalPath = (doc) => `/${doc}`

export function legalDocFromPath(pathname = location.pathname) {
  const slug = pathname.replace(/^\/+|\/+$/g, '').toLowerCase()
  return LEGAL_DOCS.includes(slug) ? slug : null
}

const notify = () => window.dispatchEvent(new Event(ROUTE_EVENT))

/**
 * Opens a document from inside the app. The current history state is carried
 * along (it holds the active tab — see go() in App.jsx) so that coming back
 * lands on the screen the reader left, and `fromApp` records that there is an
 * app entry underneath to go back to.
 */
export function openLegal(doc) {
  const state = { ...history.state, legal: doc, fromApp: true }
  // Moving between two documents replaces rather than stacks, so one "back"
  // always returns to the app instead of walking through every page read.
  if (legalDocFromPath()) {
    history.replaceState({ ...state, fromApp: Boolean(history.state?.fromApp) }, '', legalPath(doc))
  } else {
    history.pushState(state, '', legalPath(doc))
  }
  notify()
}

/** Leaves the legal pages for the app. */
export function closeLegal() {
  if (history.state?.fromApp) {
    history.back()
    return
  }
  // Arrived by direct link — there is no app entry to go back to.
  history.replaceState(null, '', '/')
  notify()
}

/** The document the address bar points at, or null. Follows back/forward. */
export function useLegalRoute() {
  const [doc, setDoc] = useState(() => legalDocFromPath())
  useEffect(() => {
    const sync = () => setDoc(legalDocFromPath())
    window.addEventListener('popstate', sync)
    window.addEventListener(ROUTE_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(ROUTE_EVENT, sync)
    }
  }, [])
  return doc
}
