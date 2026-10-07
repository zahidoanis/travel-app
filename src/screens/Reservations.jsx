import { useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import TicketPhoto from '../components/TicketPhoto'
import { Plus, X, Ticket, Phone } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { useConfirm } from '../components/Confirm'
import { t, locale } from '../i18n'

// "3.10" in Hebrew, "10/3" in English — the stored ISO date's last five
// characters ("10-03") read as neither.
const shortDate = (iso) => {
  const d = iso ? new Date(`${iso}T00:00:00`) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(locale, { day: 'numeric', month: 'numeric' }) : ''
}

/**
 * Bookings kept for this trip, plus tickets saved without a real booking
 * behind them — a flight, an already-bought ticket, anything that just
 * needs its photo kept somewhere findable. Used to live at the bottom of
 * the itinerary screen, past a scroll most people never reached; a first-
 * class tab is the only way "there's a place to keep your tickets" is
 * actually discoverable.
 */
export default function Reservations() {
  const { trip, reservations, addReservation, removeReservation, canEdit } = useTrip()

  const [addingTicket, setAddingTicket] = useState(false)
  const [ticketName, setTicketName] = useState('')

  const confirm = useConfirm()

  if (!trip) return null

  // Removing a reservation also deletes the photo of the ticket attached to
  // it, and neither can be brought back.
  const cancel = async (r) => {
    const ok = await confirm({
      title: t('להסיר את {place}?', { place: r.place }),
      body: t('ההזמנה ותמונת הכרטיס שצורפה אליה יימחקו עבור כל מי שבטיול.'),
      action: t('הסר'),
    })
    if (ok) removeReservation(r.id)
  }

  const saveTicket = () => {
    const name = ticketName.trim()
    if (!name) return
    addReservation({ place: name, kind: 'ticket', date: trip.from, time: '', party: 1 })
    setTicketName('')
    setAddingTicket(false)
  }

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <div className="between" style={{ alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <h1 className="h1" style={{ fontSize: 24 }}>
              {t('ההזמנות שלך')}{reservations.length > 0 ? ` (${reservations.length})` : ''}
            </h1>
            <p className="tiny" style={{ marginTop: 4 }}>{trip.city}</p>
          </div>
          {canEdit && reservations.length > 0 && (
            <button
              className="icon-btn boxed"
              onClick={() => setAddingTicket(true)}
              aria-label={t('הוסף כרטיס')}
              title={t('הוסף כרטיס')}
            ><Plus size={18} /></button>
          )}
        </div>

        {/* An empty tab says what goes here and offers the one action, rather
            than a paragraph pointing at a small + in the corner. */}
        {reservations.length === 0 && (
          <div className="card empty-state" style={{ marginTop: 20 }}>
            <span className="empty-icon"><Ticket size={22} /></span>
            <strong style={{ fontSize: 15 }}>{t('עוד אין הזמנות')}</strong>
            <p className="tiny" style={{ margin: '6px 0 16px', maxWidth: '34ch' }}>
              {t('שמרו כאן כרטיסי טיסה, כניסות לאתרים והזמנות מסעדה — עם צילום של הכרטיס, כדי שיהיה בהישג יד ביום עצמו.')}
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setAddingTicket(true)}>
              <Plus size={15} /> {t('הוסף כרטיס או הזמנה')}
            </button>
            <p className="tiny" style={{ marginTop: 12 }}>
              {t('אפשר גם להזמין ישירות מעצירה במסלול: ⋯ ← הזמנת מקום או כרטיסים.')}
            </p>
          </div>
        )}

        {reservations.length > 0 && (
          <div className="col" style={{ gap: 9, marginTop: 20 }}>
            {reservations.map((r) => (
              <div key={r.id} className="reservation">
                {r.time ? (
                  <span className="reservation-when">
                    <strong className="num">{r.time}</strong>
                    <span className="tiny num">{shortDate(r.date)}</span>
                  </span>
                ) : (
                  <span className="reservation-when"><Ticket size={16} /></span>
                )}
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{r.place}</strong>
                  {r.kind !== 'ticket' && (
                    <span className="tiny">
                      <span className="num">{r.party}</span> {r.kind === 'food' ? t('סועדים') : t('משתתפים')}
                      {r.phone ? ` · ${t('יש טלפון')}` : ''}
                    </span>
                  )}
                </span>
                {r.phone && (
                  <a
                    className="icon-btn"
                    href={`tel:${r.phone.replace(/\s/g, '')}`}
                    aria-label={t('התקשר ל{place}', { place: r.place })}
                  ><Phone size={14} /></a>
                )}
                <TicketPhoto tripId={trip.id} ticketId={r.id} />
                {canEdit && (
                  <button
                    className="icon-btn"
                    onClick={() => cancel(r)}
                    aria-label={t('בטל את {place}', { place: r.place })}
                  ><X size={13} /></button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={addingTicket} title={t('הוסף כרטיס')} onClose={() => setAddingTicket(false)}>
        <span className="label">{t('מה זה?')}</span>
        <input
          className="field" style={{ marginBottom: 16 }}
          value={ticketName}
          onChange={(e) => setTicketName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveTicket()}
          placeholder={t('לדוגמה: טיסת חזרה, כניסה לטירה')}
          aria-label={t('מה זה')}
          autoFocus
        />
        <button className="btn btn-primary btn-block" onClick={saveTicket} disabled={!ticketName.trim()}>
          <Plus size={16} /> {t('הוסף כרטיס')}
        </button>
      </Sheet>
    </div>
  )
}
