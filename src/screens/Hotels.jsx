import { useState } from 'react'
import TopBar from '../components/TopBar'
import { Bed, MapPin, X, Plus } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { search } from '../lib/geocode'

/**
 * Where you're sleeping — separate from the onboarding wizard so it stays
 * reachable after the trip exists, not just during setup. Adding more than
 * one hotel already worked before this screen did; what it adds is a date
 * range per stay, so the map (and anyone glancing at the trip) can tell
 * which hotel applies to which nights once there's more than one.
 */
export default function Hotels() {
  const { trip, addStay, updateStay, removeStay } = useTrip()
  const [name, setName] = useState('')
  const [hits, setHits] = useState([])
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState(null)

  const stays = trip?.stays ?? []

  const findHotel = async () => {
    const q = name.trim()
    if (!q || locating) return
    setLocating(true)
    setError(null)
    setHits([])
    const results = await search(`${q}, ${trip.city}`, 5)
    setHits(results)
    if (results.length === 0) setError('לא מצאתי מלון בשם הזה ביעד. נסה שם מדויק יותר.')
    setLocating(false)
  }

  const pick = (h) => {
    addStay({ name: h.name, label: h.label, lat: h.lat, lng: h.lng })
    setName('')
    setHits([])
  }

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <h1 className="h1" style={{ fontSize: 24 }}>מלונות</h1>
        <p className="tiny" style={{ marginTop: 4 }}>
          מקומות הלינה בטיול — אפשר להוסיף כמה, ולסמן לאילו תאריכים כל אחד שייך
        </p>
      </div>

      <div className="pad" style={{ marginTop: 18 }}>
        {stays.length === 0 ? (
          <p className="tiny">עוד לא הוספתם מלון.</p>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {stays.map((s) => (
              <div key={s.label} className="card">
                <div className="between" style={{ alignItems: 'flex-start', marginBottom: stays.length > 1 ? 12 : 0 }}>
                  <span className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--lav)', marginTop: 2 }}><Bed size={17} /></span>
                    <span className="col" style={{ gap: 2, minWidth: 0 }}>
                      <strong style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</strong>
                      <span className="tiny stay-address">{s.label}</span>
                    </span>
                  </span>
                  <button
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    onClick={() => removeStay(s.label)}
                    aria-label={`הסר את ${s.name}`}
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* A single hotel covers the whole trip by definition — dates
                    only mean something once there is more than one to
                    choose between. */}
                {stays.length > 1 && (
                  <div className="row" style={{ gap: 8 }}>
                    <label className="col" style={{ gap: 3, flex: 1 }}>
                      <span className="tiny">מתאריך</span>
                      <input
                        type="date"
                        className="field"
                        value={s.checkIn ?? ''}
                        min={trip.from}
                        max={trip.to}
                        onChange={(e) => updateStay(s.label, { checkIn: e.target.value })}
                      />
                    </label>
                    <label className="col" style={{ gap: 3, flex: 1 }}>
                      <span className="tiny">עד תאריך</span>
                      <input
                        type="date"
                        className="field"
                        value={s.checkOut ?? ''}
                        min={trip.from}
                        max={trip.to}
                        onChange={(e) => updateStay(s.label, { checkOut: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pad" style={{ marginTop: 22 }}>
        <span className="label">הוסף מלון</span>
        <div className="row field-row" style={{ marginBottom: 10 }}>
          <Bed size={18} />
          <input
            className="field-bare"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && findHotel()}
            placeholder={`לדוגמה: Hilton ${trip.city}`}
            aria-label="שם המלון"
          />
          {locating && <span className="typing"><i /><i /><i /></span>}
        </div>

        <button className="btn btn-ghost btn-block" onClick={findHotel} disabled={locating || !name.trim()}>
          <MapPin size={16} />
          אתר את המיקום
        </button>

        {error && (
          <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>
        )}

        {hits.length > 0 && (
          <div className="col" style={{ gap: 9, marginTop: 16 }}>
            {hits.map((h) => (
              <button
                key={`${h.lat},${h.lng}`}
                className="choice"
                style={{ padding: 13 }}
                onClick={() => pick(h)}
              >
                <span className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ color: 'var(--lav)', marginTop: 2 }}><MapPin size={15} /></span>
                  <span className="grow" style={{ textAlign: 'start', minWidth: 0 }}>
                    <span className="choice-title" style={{ marginTop: 0 }}>{h.name}</span>
                    <span className="choice-sub stay-address">{h.label}</span>
                  </span>
                  <Plus size={16} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
