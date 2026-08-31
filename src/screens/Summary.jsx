import TopBar from '../components/TopBar'
import { Printer, Plane, Bed, Users } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { memberAge } from '../data'
import { dateForDay } from './Days'

/**
 * A clean, read-only document of the whole trip — every day, not just the
 * one currently open — meant to be printed or saved as a PDF rather than
 * tapped through. A hotel concierge, a printed backup for someone without a
 * phone abroad, or just a paper copy in a bag: none of those want the app's
 * own chrome, so print styles (styles.css) strip it down to this content
 * alone when the browser actually prints the page.
 */
export default function Summary() {
  const { trip, days, families } = useTrip()

  if (!trip) return null

  const dayList = Array.from({ length: trip.totalDays }, (_, i) => i + 1)
  const flight = trip.flight
  const hasFlight = flight && (flight.airline || flight.number || flight.arrivalAirport)
  const stays = trip.stays ?? []

  return (
    <div className="screen summary-screen">
      <TopBar />

      <div className="pad summary-header">
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 className="h1" style={{ fontSize: 24 }}>
              {trip.city}{trip.country ? `, ${trip.country}` : ''}
            </h1>
            <p className="tiny" style={{ marginTop: 4 }}>
              {trip.from} — {trip.to} · <span className="num">{trip.totalDays}</span> ימים
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => window.print()}>
            <Printer size={16} />
            הדפס
          </button>
        </div>
      </div>

      <div className="pad summary-section">
        <span className="label"><Users size={13} /> נוסעים</span>
        <div className="col" style={{ gap: 6 }}>
          {families.map((f) => {
            const ages = f.members.map(memberAge).filter(Boolean)
            return (
              <p key={f.id} className="tiny" style={{ margin: 0 }}>
                <strong>{f.name}:</strong>{' '}
                {f.members.length} נוסעים
                {ages.length > 0 ? ` · ילדים בני ${ages.join(', ')}` : ''}
              </p>
            )
          })}
        </div>
      </div>

      {(hasFlight || stays.length > 0) && (
        <div className="pad summary-section">
          {hasFlight && (
            <p className="tiny" style={{ margin: '0 0 6px' }}>
              <Plane size={13} /> <strong>טיסה:</strong>{' '}
              {[flight.airline, flight.number, flight.arrivalAirport].filter(Boolean).join(' · ')}
            </p>
          )}
          {stays.map((s) => (
            <p key={s.label} className="tiny" style={{ margin: '0 0 6px' }}>
              <Bed size={13} /> <strong>{s.name}</strong>
              {s.checkIn || s.checkOut ? ` (${s.checkIn ?? '?'} — ${s.checkOut ?? '?'})` : ''}
              {' — '}{s.label}
            </p>
          ))}
        </div>
      )}

      {dayList.map((day) => {
        const stops = [...(days[day] ?? [])].sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
        return (
          <div key={day} className="pad summary-day">
            <h2 className="h3">
              יום {day} — {dateForDay(trip, day) ?? ''}
            </h2>
            {stops.length === 0 ? (
              <p className="tiny">אין עדיין לו"ז ליום הזה.</p>
            ) : (
              <div className="col" style={{ gap: 4 }}>
                {stops.map((s) => (
                  <p key={s.id} className="tiny" style={{ margin: 0 }}>
                    <span className="num">{s.time}</span> · {s.he}
                    {s.desc ? ` — ${s.desc}` : ''}
                  </p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
