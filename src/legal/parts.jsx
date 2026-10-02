import { OPERATOR } from './operator'
import { legalPath, openLegal } from './route'

/**
 * One operator detail, or a marker that cannot be missed when it has not
 * been filled in yet (see operator.js). `label` is what the marker says is
 * missing, in the language of the page it sits on.
 */
export function Field({ name, label }) {
  const value = OPERATOR[name]
  if (value) return <span>{value}</span>
  return <mark className="legal-missing">[{label}]</mark>
}

export function Email({ label }) {
  if (!OPERATOR.email) return <mark className="legal-missing">[{label}]</mark>
  return <a href={`mailto:${OPERATOR.email}`} className="ltr">{OPERATOR.email}</a>
}

/** A link out of the site. */
export function Ext({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}

/**
 * A link to one of the legal pages. A real href — so it can be opened in a
 * new tab, copied, and read by a crawler — that a plain click handles in
 * place, without reloading the app and losing whatever was on screen.
 */
export function LegalLink({ doc, children, ...rest }) {
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    openLegal(doc)
  }
  return <a href={legalPath(doc)} onClick={onClick} {...rest}>{children}</a>
}