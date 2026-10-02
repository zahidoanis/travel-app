// A legal document, kept whole per language (see accessibility.he.jsx)
// rather than as hundreds of t() keys. The Hebrew version is the binding
// one; this is its translation and has to say the same thing.
import { OPERATOR } from './operator'
import { Field, Email } from './parts'

export default function AccessibilityEn() {
  return (
    <>
      <p>
        We want TripAI to be usable by everyone, including people with disabilities. This page
        describes what has been done to make the site accessible, what is not accessible yet, and
        how to reach us when you run into difficulty.
      </p>

      <section>
        <h2>Level of accessibility</h2>
        <p>
          The site was built with the aim of meeting Regulation 35 of the Israeli Equal Rights for
          Persons with Disabilities (Service Accessibility Adjustments) Regulations, 5773-2013, and
          Israeli Standard IS 5568, which is based on the WCAG 2.0 guidelines at level AA. The site
          is partially accessible: the parts that do not yet meet the standard are listed further
          down this page.
        </p>
      </section>

      <section>
        <h2>What has been done</h2>
        <ul>
          <li>The site can be operated with a keyboard alone, and a clear indicator shows where the focus is.</li>
          <li>A "Skip to main content" link at the start of each screen lets you skip the navigation menu.</li>
          <li>
            Pop-up panels take the focus when they open, keep it inside them, close with the Escape
            key and return the focus to where they were opened from.
          </li>
          <li>Buttons shown as an icon only have a text description for screen readers.</li>
          <li>The page language and reading direction are set in the code, in Hebrew (right to left) and in English (left to right).</li>
          <li>The display can be enlarged in the browser; zooming is not blocked, and the site adapts to the width of the screen.</li>
          <li>The site respects the operating system's "reduce motion" setting and turns animations off.</li>
          <li>The colours of the main and secondary text were chosen to give a contrast ratio of at least 4.5:1 against the background.</li>
          <li>Information is not conveyed by colour alone: states are also marked with text or an icon.</li>
        </ul>
      </section>

      <section>
        <h2>Known limitations</h2>
        <ul>
          <li>
            <strong>The map</strong> is a visual component and cannot be moved with the keyboard.
            Every stop shown on it also appears as a list, with times and addresses, on the
            "Itinerary" screen and the "Printable summary" screen.
          </li>
          <li>
            <strong>Photos of destinations and sights</strong> come from Wikipedia and have no
            detailed alternative description. They are decorative; the name of the place always
            appears as text beside them.
          </li>
          <li>
            <strong>The stop cards on the map screen</strong> other than the selected one are shown
            dimmed, at lower contrast than required. The selected card is shown at full contrast.
          </li>
          <li>
            <strong>The AI agent's replies</strong> are generated automatically and may include
            place names in another language without the language markup a screen reader needs.
          </li>
          <li>
            <strong>Voice dictation</strong> is available only in browsers that support it; typing
            is always possible.
          </li>
          <li>
            <strong>External sites</strong> the site links to (maps, bookings, attractions) are not
            under our control, and we are not responsible for their accessibility.
          </li>
        </ul>
      </section>

      <section>
        <h2>How the site was tested</h2>
        <p>
          Every screen of the site was tested with an automated tool (axe-core, against the WCAG
          level A and AA rules), at desktop and phone widths, and by manually checking keyboard
          navigation. An automated tool finds only some of the possible faults. The site has not
          yet had a full audit by a licensed service-accessibility expert or been tested by users
          of assistive technology, so it may have faults that were not found.
        </p>
      </section>

      <section>
        <h2>Found a problem? Get in touch</h2>
        <p>
          If something on the site is not accessible to you, or you need the information in a
          different form, we want to hear about it and fix it. To help us deal with it quickly,
          tell us what you were trying to do, on which screen, and which browser and assistive
          technology you were using.
        </p>
        <ul>
          <li>Accessibility coordinator: <Field name="accessibilityCoordinator" label="Missing: accessibility coordinator's name" /></li>
          <li>Email: <Email label="Missing: contact email" /></li>
          {OPERATOR.phone && (
            <li>Phone: <a href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`} className="ltr">{OPERATOR.phone}</a></li>
          )}
        </ul>
        <p>We will reply within 14 business days.</p>
      </section>

      <section>
        <h2>Physical accessibility arrangements</h2>
        <p>The service is provided online only. It has no branch, office or reception desk.</p>
      </section>

      <p className="legal-fineprint">
        This is a translation. If it differs from the Hebrew version, the Hebrew version governs.
      </p>
    </>
  )
}
