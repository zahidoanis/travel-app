import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import MapCanvas from '../components/MapCanvas'
import Sheet from '../components/Sheet'
import { Star, Info, Navigation, Clock, Layers, Locate, Plus, Footprints, MapPin } from '../components/Icons'
import { CATEGORIES } from '../data'
import { useTrip } from '../TripProvider'
import { PROVIDERS } from '../lib/tiles'
import { navigateUrl } from '../lib/staticMap'
import { stepsFromMeters } from '../lib/geo'

// A live dot older than this is more likely someone who closed the app
// without switching sharing off than someone standing still that long —
// there is no way to run code when a tab closes to mark it inactive itself.
const PRESENCE_STALE_MS = 10 * 60 * 1000

/** The calendar date of day N of the trip, as the same "YYYY-MM-DD" shape
 *  a stay's checkIn/checkOut is stored in. */
function dateForDay(fromISO, day) {
  const d = new Date(fromISO)
  d.setDate(d.getDate() + (day - 1))
  return d.toISOString().slice(0, 10)
}

export default function MapScreen() {
  const {
    stops: STOPS, days, activeDay, setActiveDay, planning, trip,
    presence, sharingLocation, toggleLocationSharing, todayMeters,
  } = useTrip()
  const livePeople = presence.filter(
    (p) => p.active && p.lat != null && Date.now() - (p.updatedAt?.seconds ?? 0) * 1000 < PRESENCE_STALE_MS
  )
  const dayList = trip ? Array.from({ length: trip.totalDays }, (_, i) => i + 1) : []
  // A stay only reaches the map at all once it has real coordinates, from the
  // same geocoding step onboarding already runs when one is added. With more
  // than one hotel, the active day's date picks which one — falling back to
  // the first when no stay's range covers it, which is also what happens for
  // trips made before per-stay dates existed.
  const locatedStays = trip?.stays?.filter((s) => s.lat != null && s.lng != null) ?? []
  const hotel =
    locatedStays.length <= 1
      ? locatedStays[0] ?? null
      : locatedStays.find((s) => {
          if (!s.checkIn && !s.checkOut) return false
          const day = dateForDay(trip.from, activeDay)
          return (!s.checkIn || day >= s.checkIn) && (!s.checkOut || day <= s.checkOut)
        }) ?? locatedStays[0] ?? null
  const [activeId, setActiveId] = useState(null)
  const [details, setDetails] = useState(null)
  const [provider, setProvider] = useState('cartoLight')
  const deckRef = useRef(null)

  // Switching days used to leave the map showing one day's pins with the
  // card carousel still on the previous day's stop — every day's stops were
  // generated with plain 1/2/3 ids, so day 1's stop 3 and day 2's stop 3
  // shared a literal id, and the check below found a "match" that was
  // actually a different place. Fixed at the source (itinerary.js scopes
  // the id to the day now), but changing day is a big enough context switch
  // to always start fresh regardless — not worth trusting every future id
  // scheme to stay collision-free.
  useEffect(() => { setActiveId(null) }, [activeDay])

  // The itinerary is regenerated per destination, so the active id has to
  // follow it rather than being captured once at mount.
  useEffect(() => {
    if (STOPS.length === 0) return
    if (!STOPS.some((s) => s.id === activeId)) {
      setActiveId(STOPS[Math.min(1, STOPS.length - 1)].id)
    }
  }, [STOPS, activeId])

  // Keep the carousel and the map pin in sync in both directions.
  useEffect(() => {
    const deck = deckRef.current
    if (!deck || activeId == null) return
    const card = deck.querySelector(`[data-stop="${activeId}"]`)
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeId])

  // Rendered in both branches below — a day with no stops still needs a way
  // out of itself. This used to live only in the branch below the empty-
  // state check, so switching to an empty day made the switcher disappear
  // along with everything else, with no way back to a day that had stops.
  const daySwitcher = dayList.length > 1 && (
    <div className="day-strip">
      <div className="hscroll">
        {dayList.map((d) => (
          <button
            key={d}
            className={`pill ${d === activeDay ? 'on' : ''}`}
            onClick={() => setActiveDay(d)}
          >
            יום <span className="num">{d}</span>
            {(days[d]?.length ?? 0) > 0 && (
              <> · <span className="num">{days[d].length}</span> עצירות</>
            )}
          </button>
        ))}
      </div>
    </div>
  )

  if (STOPS.length === 0) {
    return (
      <div className="map-screen" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'relative', zIndex: 10 }}>
          <TopBar floating />
        </div>
        {daySwitcher}
        <div className="card" style={{ textAlign: 'center', maxWidth: 300 }}>
          {planning ? (
            <>
              <span className="typing"><i /><i /><i /></span>
              <p className="sub" style={{ marginTop: 12 }}>הסוכן בונה את המסלול...</p>
            </>
          ) : (
            <p className="sub">אין עדיין עצירות במסלול. חזור למסך הבית ובנה מסלול.</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="map-screen">
      <MapCanvas
        stops={STOPS}
        activeId={activeId}
        onPinClick={setActiveId}
        provider={provider}
        hotel={hotel}
        people={livePeople}
      />

      <div style={{ position: 'relative', zIndex: 10 }}>
        <TopBar floating />
      </div>

      {daySwitcher}

      <div className="map-tools">
        <button
          className="map-tool"
          onClick={() => {
            const keys = Object.keys(PROVIDERS)
            setProvider(keys[(keys.indexOf(provider) + 1) % keys.length])
          }}
          aria-label={`שכבת מפה: ${PROVIDERS[provider].label}`}
          title={PROVIDERS[provider].label}
        >
          <Layers size={18} />
        </button>
        <button className="map-tool" aria-label="מרכז על המיקום שלי"><Locate size={18} /></button>
        <button className="map-tool" aria-label="הוסף עצירה"><Plus size={18} /></button>
        <button
          className={`map-tool ${sharingLocation ? 'on' : ''}`}
          onClick={toggleLocationSharing}
          aria-label={sharingLocation ? 'הפסק לשתף מיקום חי' : 'שתף מיקום חי עם הקבוצה'}
          aria-pressed={sharingLocation}
          title="מיקום חי"
        >
          <MapPin size={18} />
        </button>
      </div>

      {/* Only once sharing is on — the count means nothing to someone not
          currently being tracked, and showing "0" the rest of the time would
          just invite the question of why it never moves. */}
      {sharingLocation && (
        <div className="steps-badge">
          <Footprints size={13} />
          <span className="num">{stepsFromMeters(todayMeters).toLocaleString('en-US')}</span> צעדים משוערכים היום
        </div>
      )}

      <div className="stop-deck">
        <div className="hscroll" ref={deckRef}>
          {STOPS.map((s) => {
            const on = s.id === activeId
            const cat = CATEGORIES[s.cat]
            return (
              <div
                key={s.id}
                data-stop={s.id}
                className={`stop-card glass ${on ? 'active' : ''}`}
                onClick={() => setActiveId(s.id)}
              >
                <div className="between" style={{ marginBottom: 9 }}>
                  <span className="tiny row" style={{ gap: 5 }}>
                    <span className="num">{s.time}</span>
                    <Clock size={13} />
                  </span>
                  <span className="star"><span className="num">{s.rating}</span><Star size={13} /></span>
                </div>

                <h3 className="h3" style={{ fontSize: 16, marginBottom: 6 }}>{s.he}</h3>
                <p className="tiny" style={{ margin: '0 0 13px', minHeight: 34 }}>{s.desc}</p>

                <div className="between">
                  <a
                    className="btn btn-primary btn-sm"
                    href={navigateUrl(s.lat, s.lng, s.name)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Navigation size={15} />
                    ניווט
                  </a>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="tiny row" style={{ gap: 5 }}>
                      <i className="dot" style={{ background: cat.color, width: 7, height: 7 }} />
                      {cat.label}
                    </span>
                    <button
                      className="icon-btn boxed"
                      style={{ width: 32, height: 32 }}
                      onClick={(e) => { e.stopPropagation(); setDetails(s) }}
                      aria-label={`פרטים על ${s.he}`}
                    >
                      <Info size={15} />
                    </button>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Sheet open={Boolean(details)} title={details?.he ?? ''} onClose={() => setDetails(null)}>
        {details && (
          <>
            <div
              style={{
                height: 130, borderRadius: 16, marginBottom: 16,
                border: '1px solid var(--border)',
                background: `linear-gradient(150deg, ${CATEGORIES[details.cat].color}26, var(--card-2))`,
              }}
            />
            <div className="between" style={{ marginBottom: 14 }}>
              <span className="star"><Star size={14} /><span className="num">{details.rating}</span></span>
              <span className="badge">{CATEGORIES[details.cat].label}</span>
            </div>
            <p className="sub" style={{ marginBottom: 16 }}>{details.desc}</p>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="between" style={{ marginBottom: 10 }}>
                <span className="tiny">שעת הגעה מתוכננת</span>
                <strong className="num" style={{ fontSize: 14 }}>{details.time}</strong>
              </div>
              <div className="between">
                <span className="tiny">קואורדינטות</span>
                <span className="num tiny">{details.lat.toFixed(4)}, {details.lng.toFixed(4)}</span>
              </div>
            </div>

            <a
              className="btn btn-primary btn-block"
              href={navigateUrl(details.lat, details.lng, details.name)}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation size={17} />
              פתח ניווט ב-Google Maps
            </a>
          </>
        )}
      </Sheet>
    </div>
  )
}
