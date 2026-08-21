import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import {
  Phone, Globe, Clock, Users, Calendar, Check, Navigation, Ticket, Info,
} from './Icons'
import { useTrip } from '../TripProvider'
import { search } from '../lib/geocode'
import { breadcrumb } from '../lib/telemetry'

/**
 * Booking a table or a ticket.
 *
 * There is no free reservation API — OpenTable, TheFork, Resy and
 * GetYourGuide all sit behind partner agreements. So rather than fake an
 * in-app confirmation, this gets you to the real booking in one tap: the
 * venue's actual phone number and website, pulled from OpenStreetMap, plus
 * the platforms that do handle reservations. What the app keeps is the
 * record — who, when, how many — attached to the trip.
 */
export default function BookingSheet({ open, place, kind = 'food', onClose }) {
  const { trip, addReservation } = useTrip()

  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [date, setDate] = useState(trip?.from ?? '')
  const [time, setTime] = useState(kind === 'food' ? '19:30' : '10:00')
  const [party, setParty] = useState(2)
  const [saved, setSaved] = useState(false)

  // Contact details live on a separate, slower lookup, so it only runs when
  // the sheet is actually opened.
  useEffect(() => {
    if (!open || !place) return
    let cancelled = false

    setLoading(true)
    setDetails(null)
    setSaved(false)

    search(`${place.name}, ${trip?.city ?? ''}`, 1, undefined, true)
      .then((hits) => {
        if (!cancelled) setDetails(hits[0] ?? null)
      })
      .finally(() => !cancelled && setLoading(false))

    return () => { cancelled = true }
  }, [open, place, trip?.city])

  if (!place) return null

  const query = encodeURIComponent(`${place.name}, ${trip?.city ?? ''}`)
  const hasContact = details?.phone || details?.website

  const keep = () => {
    addReservation({
      place: place.name,
      city: trip?.city ?? '',
      kind,
      date,
      time,
      party,
      phone: details?.phone ?? null,
      lat: place.lat ?? details?.lat ?? null,
      lng: place.lng ?? details?.lng ?? null,
    })
    breadcrumb('action', `reservation saved: ${place.name}`)
    setSaved(true)
    setTimeout(onClose, 900)
  }

  return (
    <Sheet open={open} title={place.name} onClose={onClose}>
      {/* What we actually know about the place */}
      <div className="card" style={{ marginBottom: 16 }}>
        {loading && (
          <div className="row" style={{ gap: 9 }}>
            <span className="typing"><i /><i /><i /></span>
            <span className="tiny">מאתר פרטי קשר...</span>
          </div>
        )}

        {!loading && !hasContact && (
          <p className="tiny" style={{ margin: 0 }}>
            אין פרטי קשר ל{place.name} ב-OpenStreetMap. אפשר להגיע אליהם דרך המפה.
          </p>
        )}

        {!loading && hasContact && (
          <div className="col" style={{ gap: 11 }}>
            {details.phone && (
              <a className="contact-row" href={`tel:${details.phone.replace(/\s/g, '')}`}>
                <span className="contact-icon"><Phone size={15} /></span>
                <span className="grow">
                  <strong>התקשר להזמנה</strong>
                  <span className="tiny ltr">{details.phone}</span>
                </span>
              </a>
            )}

            {details.website && (
              <a className="contact-row" href={details.website} target="_blank" rel="noreferrer">
                <span className="contact-icon"><Globe size={15} /></span>
                <span className="grow">
                  <strong>האתר הרשמי</strong>
                  <span className="tiny ltr">{details.website.replace(/^https?:\/\//, '').slice(0, 34)}</span>
                </span>
              </a>
            )}

            {details.hours && (
              <div className="contact-row" style={{ pointerEvents: 'none' }}>
                <span className="contact-icon"><Clock size={15} /></span>
                <span className="grow">
                  <strong>שעות פתיחה</strong>
                  <span className="tiny ltr">{details.hours}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The reservation itself */}
      <span className="label">פרטי ההזמנה</span>
      <div className="date-grid" style={{ marginBottom: 11 }}>
        <label className="date-cell">
          <span className="label"><Calendar size={12} /> תאריך</span>
          <input
            type="date"
            className="field"
            value={date}
            min={trip?.from}
            max={trip?.to}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="date-cell">
          <span className="label"><Clock size={12} /> שעה</span>
          <input type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      <div className="party-row" style={{ marginBottom: 18 }}>
        <span className="contact-icon"><Users size={15} /></span>
        <span className="grow" style={{ fontSize: 13.5, fontWeight: 600 }}>
          {kind === 'food' ? 'כמה סועדים' : 'כמה משתתפים'}
        </span>
        <span className="stepper">
          <button onClick={() => setParty((n) => Math.max(1, n - 1))} aria-label="פחות">−</button>
          <span className="num">{party}</span>
          <button onClick={() => setParty((n) => Math.min(20, n + 1))} aria-label="עוד">+</button>
        </span>
      </div>

      {/* Where the booking actually happens */}
      <span className="label">להזמין דרך</span>
      <div className="row" style={{ gap: 9, marginBottom: 18 }}>
        <a
          className="btn btn-ghost btn-sm grow"
          href={`https://www.google.com/maps/search/?api=1&query=${query}`}
          target="_blank"
          rel="noreferrer"
        >
          <Navigation size={14} />
          Google Maps
        </a>
        {kind !== 'food' && (
          <a
            className="btn btn-ghost btn-sm grow"
            href={`https://www.getyourguide.com/s/?q=${query}`}
            target="_blank"
            rel="noreferrer"
          >
            <Ticket size={14} />
            כרטיסים
          </a>
        )}
      </div>

      <button className="btn btn-primary btn-block" onClick={keep} disabled={!date || saved}>
        {saved ? <><Check size={17} /> נשמר</> : <>שמור את ההזמנה במסלול</>}
      </button>

      <div className="row" style={{ alignItems: 'flex-start', gap: 9, marginTop: 14 }}>
        <span style={{ color: 'var(--muted)' }}><Info size={14} /></span>
        <p className="tiny" style={{ margin: 0 }}>
          האפליקציה לא מבצעת את ההזמנה — אין ממשק הזמנות חינמי. היא נותנת לך את
          הטלפון והאתר האמיתיים, ושומרת את הפרטים אצלך במסלול.
        </p>
      </div>
    </Sheet>
  )
}
