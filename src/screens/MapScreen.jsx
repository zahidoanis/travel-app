import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import MapCanvas from '../components/MapCanvas'
import Sheet from '../components/Sheet'
import { Star, Info, Navigation, Clock, Layers, Locate, Plus } from '../components/Icons'
import { CATEGORIES } from '../data'
import { useTrip } from '../TripProvider'
import { PROVIDERS } from '../lib/tiles'
import { navigateUrl } from '../lib/staticMap'

export default function MapScreen() {
  const { stops: STOPS, days, activeDay, setActiveDay, planning, trip } = useTrip()
  const dayList = trip ? Array.from({ length: trip.totalDays }, (_, i) => i + 1) : []
  // Whichever hotel is first in the list — most trips have exactly one, and
  // a stay only reaches the map at all once it has real coordinates, from
  // the same geocoding step onboarding already runs when one is added.
  const hotel = trip?.stays?.find((s) => s.lat != null && s.lng != null) ?? null
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
      <MapCanvas stops={STOPS} activeId={activeId} onPinClick={setActiveId} provider={provider} hotel={hotel} />

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
      </div>

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
