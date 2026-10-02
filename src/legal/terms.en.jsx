// A legal document, kept whole per language (see terms.he.jsx) rather than
// as hundreds of t() keys. The Hebrew version is the binding one; this is
// its translation and has to say the same thing section for section.
import { Field, Email, Ext, LegalLink } from './parts'

export default function TermsEn() {
  return (
    <>
      <p>
        Welcome to TripAI. These terms are the agreement between you and the operator of the site.
        Using the site means you accept them and the <LegalLink doc="privacy">Privacy Policy</LegalLink>.
        If you do not agree, please do not use the site.
      </p>

      <section>
        <h2>1. Who we are</h2>
        <p>
          The site is operated by <Field name="name" label="Missing: operator name" /> ("we"). To
          get in touch: <Email label="Missing: contact email" />.
        </p>
      </section>

      <section>
        <h2>2. Who may use the site</h2>
        <p>
          The site is intended for people aged 18 and over. A minor may use it only with the
          permission of a parent or guardian, who accepts these terms on the minor's behalf and is
          responsible for that use.
        </p>
      </section>

      <section>
        <h2>3. What the service is — and is not</h2>
        <p>
          TripAI is a trip-planning aid: it builds a day-by-day itinerary with the help of
          artificial intelligence, shows it on a map, shares it with the people you are travelling
          with and keeps track of expenses. The service is free.
        </p>
        <p>
          <strong>We are not a travel agency.</strong> The site does not sell, book or guarantee
          flights, accommodation, tickets or any other travel service, and takes no money.
          "Reservations" on the site are a record you keep for yourself — they do not create a
          booking with any provider. Every purchase or booking is made directly with the provider,
          on its terms and at its responsibility.
        </p>
      </section>

      <section>
        <h2>4. AI-generated content</h2>
        <p>
          The itineraries, recommendations and replies from the agent are produced by an artificial
          intelligence model. Such a model <strong>can be wrong, can give out-of-date information
          and can make details up</strong> — the name of a place, an address, opening hours, a
          price, a travel time, or a place that does not exist at all.
        </p>
        <ul>
          <li>Check every important detail against an official source before you rely on it, book, or set out.</li>
          <li>
            The content is not professional advice. In particular, do not rely on it for visas and
            entry requirements, health and vaccinations, insurance, safety or travel warnings —
            check those with the official bodies.
          </li>
          <li>The agent does not make bookings or contact providers on your behalf, even if its reply sounds as though it did.</li>
        </ul>
      </section>

      <section>
        <h2>5. Third-party information</h2>
        <p>
          The maps, photos, weather forecast, currency rates and place details come from outside
          sources (see section 12). We do not check them and are not responsible for their
          accuracy, completeness or availability.
        </p>
        <ul>
          <li>Currency rates are for orientation only; they are not a transaction rate and not financial advice.</li>
          <li>
            The expense split is a calculation aid. The site moves no money and is not bookkeeping;
            settling up is between you.
          </li>
          <li>
            Locations and navigation links may be inaccurate. On the road, follow local law and the
            conditions in front of you, and do not operate the site while driving.
          </li>
        </ul>
      </section>

      <section>
        <h2>6. External links and affiliate links</h2>
        <p>
          The site links to other sites, such as Google Maps, flight and hotel search sites,
          GetYourGuide and Viator. We do not control them and are not responsible for their
          content, their prices or any transaction you make there.
        </p>
        <p>
          <strong>Disclosure:</strong> some links, and in particular links to attractions on
          Viator, are affiliate links — if you book through them we may receive a commission, at no
          extra cost to you. This does not affect the price you pay.
        </p>
      </section>

      <section>
        <h2>7. Accounts and shared trips</h2>
        <ul>
          <li>
            The invitation link and the join code are the key to a trip. Anyone who holds them can
            join, see everything in the trip and edit it. You are responsible for who you pass them
            to.
          </li>
          <li>Any member of a trip can change and delete content in it. The person who created the trip can delete the whole trip, for everyone.</li>
          <li>Without signing in with a Google account, the trip is tied to the browser it was created in and may be lost if the browser's data is cleared.</li>
          <li>Live location sharing is something you choose to turn on, at your own responsibility, and can be turned off at any moment.</li>
        </ul>
      </section>

      <section>
        <h2>8. Your content</h2>
        <p>
          The content you enter or upload (trip details, notes, photos) remains yours. You give us
          permission to store it, process it and show it to the members of the trip, as far as is
          needed to run the service. You confirm that you have the right to upload the content, and
          that when you enter details about other people, they know about it.
        </p>
      </section>

      <section>
        <h2>9. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Upload content that is illegal, abusive, misleading or that infringes someone else's rights.</li>
          <li>Upload sensitive documents such as a passport, an identity card or a credit card.</li>
          <li>Try to reach trips or accounts that are not yours, or get around security measures or usage limits.</li>
          <li>Run automated tools against the site, scrape it or overload it.</li>
          <li>Use the AI agent for anything other than planning a trip, or to produce harmful or illegal content.</li>
          <li>Use the site commercially or offer it as a service to others without our written permission.</li>
        </ul>
        <p>We may remove content and block access where these terms are breached.</p>
      </section>

      <section>
        <h2>10. Availability and changes to the service</h2>
        <p>
          The service is free and depends on outside services with usage quotas. We do not promise
          that it will be available, uninterrupted or free of faults, or that information kept in
          it will not be lost. We may change, limit or stop the service, in whole or in part, at any
          time. Keep anything that matters to you somewhere else as well (the "Printable summary"
          screen lets you print the trip or save it as a file).
        </p>
      </section>

      <section>
        <h2>11. Intellectual property</h2>
        <p>
          The design, code, name and marks of TripAI belong to the operator of the site. The site
          may be used for personal purposes only. Third-party trademarks (Google, WhatsApp and
          others) belong to their owners; the site is not affiliated with them and does not act on
          their behalf.
        </p>
      </section>

      <section>
        <h2>12. Credits and licences</h2>
        <ul>
          <li>
            Map data and tiles: © <Ext href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</Ext>,
            under the ODbL. Address lookup: Nominatim and <Ext href="https://photon.komoot.io/">Photon</Ext>.
          </li>
          <li>
            Photos: Wikipedia and Wikimedia Commons. Each photo is subject to its creator's
            licence, as set out on the photo's page at the source.
          </li>
          <li>
            Weather: <Ext href="https://open-meteo.com/">Open-Meteo.com</Ext>, under CC BY 4.0.
          </li>
          <li>
            Currency rates: <Ext href="https://www.exchangerate-api.com">Rates By Exchange Rate API</Ext>.
          </li>
          <li>Language models: Google Gemini, with Cloudflare Workers AI as a fallback. Attractions: Viator.</li>
          <li>Fonts: Rubik, Heebo and Frank Ruhl Libre, under the SIL Open Font License.</li>
        </ul>
      </section>

      <section>
        <h2>13. Liability</h2>
        <p>
          The service is provided "as is" and as available, with no promise or representation of
          any kind about its accuracy, its fitness for your needs or its availability. Using it, and
          any decision you make based on the information in it, is your responsibility alone.
        </p>
        <p>
          As far as the law allows, we will not be liable for indirect, consequential or special
          damage, including: a missed flight or booking, costs incurred because of wrong
          information, loss of information, or damage arising from the use of a third party's site.
          In any case, our total liability will not exceed the amount you paid us for the service,
          if you paid anything.
        </p>
        <p>
          Nothing here takes away a right that cannot be waived by law, including under consumer
          protection law, or limits liability that the law does not allow to be limited.
        </p>
      </section>

      <section>
        <h2>14. Indemnity</h2>
        <p>
          If we suffer damage or face a claim because of your use of the site in breach of these
          terms or of the law, or because of content you uploaded, you will indemnify us for the
          damage and the reasonable costs we incur.
        </p>
      </section>

      <section>
        <h2>15. Ending your use</h2>
        <p>
          You may stop using the site at any time and delete your trips and your account from "Your
          account". We may stop or restrict the access of anyone who has breached these terms.
        </p>
      </section>

      <section>
        <h2>16. Changes to these terms</h2>
        <p>
          We may update these terms from time to time. The date of the last update appears at the
          top of the page. Continuing to use the site after an update means you accept the updated
          version.
        </p>
      </section>

      <section>
        <h2>17. Governing law and jurisdiction</h2>
        <p>
          These terms and the use of the site are governed solely by the laws of the State of
          Israel. Jurisdiction lies with the competent courts in Israel.
        </p>
      </section>

      <section>
        <h2>18. Contact</h2>
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
