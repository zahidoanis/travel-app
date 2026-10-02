// A legal document, kept whole per language (see privacy.he.jsx) rather
// than as hundreds of t() keys. The Hebrew version is the binding one; this
// is its translation and has to say the same thing section for section.
import { Field, Email, Ext, LegalLink } from './parts'
import { DIAGNOSTICS_RETENTION_DAYS } from './operator'

export default function PrivacyEn() {
  return (
    <>
      <p>
        This document explains what information TripAI collects, why, who it is shared with and
        what rights you have over it. We tried to write it so that it can actually be read. Your
        use of the site is also governed by the <LegalLink doc="terms">Terms of Use</LegalLink>.
      </p>

      <section>
        <h2>1. Who is responsible for your information</h2>
        <p>
          The site is operated by <Field name="name" label="Missing: operator name" /> ("we"), the
          controller of the site's database. For anything about privacy, write
          to <Email label="Missing: contact email" />.
        </p>
      </section>

      <section>
        <h2>2. Whether you have to provide information</h2>
        <p>
          You are under no legal obligation to provide information. Providing it is up to you and
          depends on your consent. That said, without the trip details (destination, dates and who
          is travelling) we cannot build an itinerary for you, and without signing in with a Google
          account the trip is kept only on the device it was created on.
        </p>
      </section>

      <section>
        <h2>3. What is collected</h2>

        <h3>Information you provide</h3>
        <ul>
          <li>
            <strong>Trip details:</strong> destination, dates and times, flight details (airline,
            flight number, airport), places you are staying and their addresses, travel style and
            food preferences, the names of the families or groups, the number of travellers and
            children's ages (optional).
          </li>
          <li>
            <strong>Content created as you use the site:</strong> stops on the itinerary,
            reservations you record, notes, expenses and how they are split, and photos of tickets
            or booking confirmations you choose to upload.
          </li>
          <li>
            <strong>Conversations with the AI agent:</strong> the messages you write, together with
            the trip details needed to answer them. Facts the agent "remembers" from the
            conversation (food preferences, for example) are saved as part of the trip, are visible
            to everyone on the trip, and can each be deleted.
          </li>
          <li>
            <strong>Google account details</strong> (only if you choose to sign in): name, email
            address and profile picture. We do not receive your password or access to anything else
            in your account.
          </li>
        </ul>

        <h3>Information collected automatically</h3>
        <ul>
          <li>
            <strong>An anonymous account identifier:</strong> when you open the app, a random
            identifier is created for you, which is what lets a trip be saved without registering.
            Reading the legal pages does not create one.
          </li>
          <li>
            <strong>Location:</strong> only if you allow it in your browser. "Centre on my location"
            uses your location on the device only and does not store it. "Live location" is a
            separate feature that you turn on yourself: while it is on, your location and your name
            are stored and shown to everyone on the trip. Turning it off deletes the last location.
          </li>
          <li>
            <strong>A crash log:</strong> when something fails, we record the error message,
            technical details about it, the address within the site where it happened, and up to
            the last 20 things you did on the site beforehand (for example "switched to the map
            screen", or the name of a destination that was created). The log is kept on your device
            and copied to the server, linked to your account identifier, and is used only to fix
            faults.
          </li>
          <li>
            <strong>Connection data:</strong> as with any website, the servers that deliver the site
            and the third-party services listed in section 6 receive your IP address and details
            about your browser.
          </li>
        </ul>

        <h3>What we do not collect</h3>
        <p>
          The site has no advertising, no tracking cookies and no marketing analytics. We do not
          collect payment details — no payment is made through the site. Voice dictation is carried
          out by your browser's own speech recognition service (Google's or Apple's, for example);
          the recording does not reach us.
        </p>
      </section>

      <section>
        <h2>4. Storage on your device</h2>
        <p>
          The site stores information in your browser (Local Storage and IndexedDB) in order to
          work: the interface language, your sign-in, a copy of the trip for use without a
          connection, which family you are, whether location sharing is on, and the crash log. All
          of these are needed for the site to function and are not used for tracking or
          advertising. You can delete them at any time in your browser settings; doing so will
          disconnect you from a trip that was not saved to a Google account.
        </p>
      </section>

      <section>
        <h2>5. What the information is used for</h2>
        <ul>
          <li>Building the itinerary, showing it on the map and answering questions through the AI agent.</li>
          <li>Saving the trip and syncing it between your devices and between the people on the trip.</li>
          <li>Finding and fixing faults, keeping the site secure and preventing abuse.</li>
          <li>Answering your requests and complying with the law.</li>
        </ul>
        <p>
          We do not sell personal information, do not use it for advertising and do not send
          marketing messages. The site does not make automated decisions about you that have legal
          effect.
        </p>
      </section>

      <section>
        <h2>6. Who the information is shared with</h2>
        <p>
          To work, the site relies on outside providers. Each receives only what its role requires,
          and also handles that information under its own privacy policy.
        </p>
        <ul>
          <li>
            <strong>Google — Firebase</strong> (hosting, sign-in, and the database that holds the
            trips, the photos you upload and the crash log). <Ext href="https://firebase.google.com/support/privacy">Policy</Ext>
          </li>
          <li>
            <strong>Cloudflare</strong> — an intermediary server that requests to the AI agent and
            place searches pass through, and a fallback AI model for when the main one is
            unavailable. <Ext href="https://www.cloudflare.com/privacypolicy/">Policy</Ext>
          </li>
          <li>
            <strong>Google — Gemini API</strong> — the AI model that writes the replies and builds
            the itineraries. It is sent the messages you write and the relevant trip details
            (destination, schedule, number of travellers and children's ages, and what the agent
            remembers). <strong>Worth knowing:</strong> under Google's terms of service, content
            sent to the model may be used by Google to improve its products, which includes being
            read by human reviewers. So do not put sensitive information in the
            conversation. <Ext href="https://ai.google.dev/gemini-api/terms">Terms</Ext>
          </li>
          <li>
            <strong>Tavily</strong> — web search. When a question needs current information (a
            price, opening hours), the text of the most recent messages in the conversation is sent
            to the search. <Ext href="https://www.tavily.com/privacy">Policy</Ext>
          </li>
          <li>
            <strong>Viator</strong> — search for attractions and tours. When you ask what there is
            to do, the text of the question and the name of the destination are sent to the
            search. <Ext href="https://www.viator.com/">Viator's site</Ext>
          </li>
          <li>
            <strong>OpenStreetMap and Photon (Komoot)</strong> — the map tiles and address lookup.
            The names of places you search for are sent to them. <Ext href="https://osmfoundation.org/wiki/Privacy_Policy">Policy</Ext>
          </li>
          <li>
            <strong>Wikipedia and Wikimedia Commons</strong> — photos of destinations and
            sights. <Ext href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy">Policy</Ext>
          </li>
          <li>
            <strong>Open-Meteo</strong> — the weather forecast for the destination. <Ext href="https://open-meteo.com/en/terms">Terms</Ext>
          </li>
          <li>
            <strong>ExchangeRate-API</strong> — currency rates. <Ext href="https://www.exchangerate-api.com/terms">Terms</Ext>
          </li>
          <li>
            <strong>Google Fonts</strong> — the site's fonts are loaded from Google's
            servers. <Ext href="https://developers.google.com/fonts/faq/privacy">Policy</Ext>
          </li>
        </ul>
        <p>
          <strong>The people on the trip.</strong> A trip is a shared space. Anyone who holds the
          invitation link or the join code can join, and anyone who has joined can see and edit
          everything in the trip: the itinerary, the reservations, the expenses, the notes, the
          ticket photos, what the agent remembers, and the live location of anyone sharing it.
          Share the link only with people you trust.
        </p>
        <p>
          <strong>External links.</strong> Links you choose to open — Google Maps, flight and hotel
          searches, GetYourGuide, Viator, WhatsApp — lead to other sites, and it is their privacy
          policies that apply there.
        </p>
        <p>
          <strong>Legal requirements.</strong> We will hand information to a competent authority if
          the law requires us to, or where that is needed to protect our rights or someone's
          safety.
        </p>
      </section>

      <section>
        <h2>7. Transfer of information outside Israel</h2>
        <p>
          The providers above store and process information on servers outside Israel, including
          in the United States and the European Union. By using the site you consent to that
          transfer.
        </p>
      </section>

      <section>
        <h2>8. How long information is kept</h2>
        <ul>
          <li>A trip is kept until the person who created it deletes it. Deleting removes it, with everything in it, for everyone on the trip.</li>
          <li>Account details are kept until you delete the account.</li>
          <li>Crash log entries are deleted after {DIAGNOSTICS_RETENTION_DAYS} days at most.</li>
          <li>The conversation with the agent is not stored on our servers; it is cleared from the browser when you close the site.</li>
        </ul>
      </section>

      <section>
        <h2>9. Security</h2>
        <p>
          Communication with the site is encrypted (HTTPS). Access to each trip is restricted on
          the server to the members of that trip, and access to account details is restricted to
          the account holder. The service keys for the AI providers are held on the server and never
          reach the browser. Even so, no system is completely immune, and we cannot promise absolute
          security. If we learn of a serious security incident affecting your information, we will
          act and report as the law requires.
        </p>
      </section>

      <section>
        <h2>10. Sensitive information</h2>
        <p>
          The site is not meant for storing sensitive documents. Do not upload photos of a
          passport, an identity card or a credit card, and do not write medical or other sensitive
          information in the conversation with the agent or in notes. A photo of a boarding pass
          contains identifying details and a booking code — upload it only to a trip whose members
          you all know.
        </p>
      </section>

      <section>
        <h2>11. Children</h2>
        <p>
          The site is intended for adults (18 and over). Minors may use it only with the permission
          of a parent or guardian, who remains responsible. Children's ages are provided, if at
          all, by the parent planning the trip and are used only to tailor the itinerary; there is
          no need to provide children's full names.
        </p>
      </section>

      <section>
        <h2>12. Your rights</h2>
        <ul>
          <li>
            <strong>Access and correction.</strong> You are entitled to see the information held
            about you and to ask for information that is inaccurate, incomplete or out of date to
            be corrected, under sections 13 and 14 of the Israeli Privacy Protection Law, 5741-1981.
            Most of it can be viewed and corrected directly on the site.
          </li>
          <li>
            <strong>Deletion.</strong> The person who created a trip can delete it from "Your
            account". Deleting the whole account, from the same screen, deletes your account details
            and the trips only you belong to, and removes you from shared trips (which stay with
            the other members).
          </li>
          <li>
            <strong>Contacting us.</strong> For any other request — including a copy of your
            information, deleting crash log entries, or withdrawing consent — write
            to <Email label="Missing: contact email" />. We will reply within 30 days.
          </li>
          <li>
            <strong>Complaints.</strong> If you believe your rights have been infringed, you may
            contact the Israeli Privacy Protection Authority.
          </li>
        </ul>
        <p>
          Residents of the European Union, the United Kingdom and some other countries may have
          additional rights under the law that applies to them (such as data portability,
          restriction of processing and objection to processing), which can be exercised at the
          same address. The basis for processing your information is your consent, the need to
          provide the service you asked for, and our legitimate interest in keeping the site
          working and secure.
        </p>
      </section>

      <section>
        <h2>13. Changes to this policy</h2>
        <p>
          We will update this document when the way the site handles information changes. The date
          of the last update appears at the top of the page, and we will announce a material change
          on the site itself.
        </p>
      </section>

      <section>
        <h2>14. Contact</h2>
        <p>
          <Field name="name" label="Missing: operator name" /> · <Email label="Missing: contact email" />
        </p>
      </section>

      <p className="legal-fineprint">
        This is a translation. If it differs from the Hebrew version, the Hebrew version governs.
      </p>
    </>
  )
}
