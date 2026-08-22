import { useState } from 'react'
import Sheet from './Sheet'
import { Info } from './Icons'

/** "היום" / "מחר" / a weekday name — a plain date reads slower once you're
 *  already looking at "the next 7 days". */
function dayLabel(dateStr, index) {
  if (index === 0) return 'היום'
  if (index === 1) return 'מחר'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long' })
}

function dayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })
}

/** "2026-08-22T14:00" -> "14:00", already in the destination's own zone. */
const hourLabel = (iso) => iso.slice(11, 16)

/**
 * Today by the hour, and the coming week — opened from the temperature line
 * on Home rather than living as its own tab, since it is a detail view on
 * data Home already fetched, not a destination of its own.
 */
export default function WeatherSheet({ open, onClose, forecast, city }) {
  const [tab, setTab] = useState('today')

  return (
    <Sheet open={open} title={`מזג האוויר ב${city}`} onClose={onClose}>
      {!forecast ? (
        <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
          <span style={{ color: 'var(--amber)' }}><Info size={15} /></span>
          <p className="tiny" style={{ margin: 0 }}>
            התחזית לא נטענה. בדוק חיבור לאינטרנט ונסה שוב.
          </p>
        </div>
      ) : (
        <>
          <div className="segmented" style={{ marginBottom: 18 }}>
            <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>
              היום
            </button>
            <button className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>
              השבוע
            </button>
          </div>

          {tab === 'today' && (
            forecast.hours.length > 0 ? (
              <div className="hscroll chips">
                {forecast.hours.map((h) => (
                  <div key={h.time} className="weather-hour">
                    <span className="tiny num">{hourLabel(h.time)}</span>
                    <span style={{ fontSize: 22 }} aria-hidden="true">{h.icon}</span>
                    <strong className="num" style={{ fontSize: 15 }}>{h.tempC}°</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="tiny">אין עוד שעות נותרות היום.</p>
            )
          )}

          {tab === 'week' && (
            <div className="col" style={{ gap: 2 }}>
              {forecast.days.map((d, i) => (
                <div key={d.date} className="between weather-day">
                  <span className="col" style={{ gap: 1 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{dayLabel(d.date, i)}</strong>
                    <span className="tiny">{dayDate(d.date)}</span>
                  </span>
                  <span className="row" style={{ gap: 10 }}>
                    <span style={{ fontSize: 19 }} aria-hidden="true">{d.icon}</span>
                    <span className="row" style={{ gap: 5 }}>
                      <strong className="num" style={{ fontSize: 14 }}>{d.tempMax}°</strong>
                      <span className="tiny num">{d.tempMin}°</span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="tiny" style={{ marginTop: 14 }}>נתוני מזג אוויר: Open-Meteo.</p>
        </>
      )}
    </Sheet>
  )
}
