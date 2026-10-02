/**
 * Who runs this site — the details the legal pages are required to show.
 *
 * FILL THESE IN BEFORE DEPLOYING. They are public: they are printed on the
 * privacy policy, the terms and the accessibility statement. A field left
 * empty renders as a highlighted "[missing]" marker on the page rather than
 * as nothing, so a gap is impossible to overlook, and `npm run legal:check`
 * exits 1 while any required field is still empty.
 *
 * Israeli law is what makes each of these required, not taste:
 *   - name + email: the privacy notice must identify the database controller
 *     and how to reach them (Privacy Protection Law, s. 11, as amended by
 *     Amendment 13).
 *   - accessibilityCoordinator + email (and a phone, if there is one): the
 *     accessibility statement must say who handles accessibility requests
 *     and how to contact them.
 */
export const OPERATOR = {
  /** Legal name of the person or company operating the site. */
  name: '',
  /** Where privacy, legal and accessibility requests are sent. */
  email: '',
  /** Optional. Shown on the accessibility statement when set. */
  phone: '',
  /** Optional. Postal address for formal notices. */
  address: '',
  /** Name of the person who handles accessibility requests. */
  accessibilityCoordinator: '',
}

/** Fields that must not be empty on a live site. */
export const REQUIRED_FIELDS = ['name', 'email', 'accessibilityCoordinator']

export const SITE_NAME = 'TripAI'
export const SITE_URL = 'https://tripai-app.web.app'

/**
 * Shown on every legal page. Bump it whenever the text of a document — or
 * what the app does with people's data — changes.
 */
export const LAST_UPDATED = '2026-10-02'

/** How long a crash-log entry is kept. db.js stamps each one with this. */
export const DIAGNOSTICS_RETENTION_DAYS = 90
