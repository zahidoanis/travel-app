import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import MapCanvas from '../components/MapCanvas'
import Sheet from '../components/Sheet'
import { Star, Info, Navigation, Clock, Layers, Locate, Plus } from '../components/Icons'
import { STOPS, CATEGORIES } from '../data'
import { navigateUrl } from '../lib/staticMap'

export default function MapScreen() {
  const [activeId, setActiveId] = useState(STOPS[1].id)
  const [details, setDetails] = useState(null)
  const deckRef = useRef(null)

  const active = STOPS.find((s) => s.id === activeId)

  // Keep the carousel and the map pin in sync in both directions.
  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return
    const card = deck.querySelector(`[data-stop="${activeId}"]`)
    card?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeId])

  return (
    <div className="map-screen">
      <MapCanvas stops={STOPS} activeId={activeId} onPinClick={setActiveId} />

      <div style={{ position: 'relative', zIndex: 10 }}>
        <TopBar floating />
      </div>

      <div className="map-tools">
        <button className="map-tool" aria-label="שכבות מפה"><Layers size={18} /></button>
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
                background: `linear-gradient(150deg, ${CATEGORIES[details.cat].color}44, #14121F)`,
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
