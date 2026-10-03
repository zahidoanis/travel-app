import { useEffect, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import MapCanvas from '../components/MapCanvas'
import Sheet from '../components/Sheet'
import { Star, Info, Navigation, Clock, Locate, Plus, MapPin, Bed } from '../components/Icons'
import { CATEGORIES } from '../data'
import { useTrip } from '../TripProvider'
import { navigateUrl } from '../lib/staticMap'
import { t, tn } from '../i18n'

// A live dot older than this is more likely someone who closed the app
// without switching sharing off than someone standing still that long —
// there is no way to run code when a tab closes to mark it inactive itself.
const PRESENCE_STALE_MS = 10 * 60 * 1000

/**
 * `embedded` — the map half of the desktop route split: no top bar or day
 * strip of its own (the list beside it has both), and one card for the
 * focused stop instead of the phone's swipeable deck. `focusId` /
 * `onFocusStop` keep it pointed at the same stop as the list.
 * `onAddStop` is the + button; `switcher` is the phone's "list" pill.
 */
export default function MapScreen({ embedded = false, focusId = null, onFocusStop, onAddStop, switcher = null }) {
  const {
    stops: ALL_STOPS, days, activeDay, setActiveDay, planning, trip,
    families, activeFamily, switchFamily,
    presence, sharingLocation, toggleLocationSharing,
  } = useTrip()
  // A stop added by hand whose place couldn't be geocoded goes into the day
  // with lat/lng null (Days.jsx says so on purpose — still useful with just a
  // time and a name). It has no position to draw, navigate to or show
  // coordinates for: it used to reach the info sheet's `lat.toFixed(4)` and
  // crash the whole map screen on tap, and MapCanvas projected null as 0,0.
  const STOPS = ALL_STOPS.filter((s) => s.lat != null && s.lng != null)
  const unlocated = ALL_STOPS.length - STOPS.length
  const livePeople = presence.filter(
    (p) => p.active && p.lat != null && Date.now() - (p.updatedAt?.seconds ?? 0) * 1000 < PRESENCE_STALE_MS
  )
  const activeFamilyObj = families.find((f) => f.id === activeFamily)
  const rangeStart = activeFamilyObj?.arriveDay ?? 1
  const rangeEnd = activeFamilyObj?.departDay ?? trip?.totalDays ?? 1
  const dayList = trip ? Array.from({ length: Math.max(0, rangeEnd - rangeStart + 1) }, (_, i) => rangeStart + i) : []
  // A stay only reaches the map at all once it has real coordinates, from the
  // same geocoding step onboarding already runs when one is added. Every
  // located stay is shown — picking just one by matching the active day
  // against check-in/check-out used to hide any stay added without those
  // dates set (the normal case right after adding one) behind whichever
  // stay happened to be first, which read as the new one never showing up.
  const locatedStays = trip?.stays?.filter((s) => s.lat != null && s.lng != null) ?? []
  const [activeId, setActiveId] = useState(null)
  const [details, setDetails] = useState(null)
  // Was a cycle through several free tile styles — CARTO locked its
  // basemaps behind an API key, leaving OSM's own tiles as the one style
  // that is still genuinely keyless, so there is nothing left to switch to.
  const provider = 'osm'
  const [myLoc, setMyLoc] = useState(null)
  const deckRef = useRef(null)

  // One-shot, unlike the live-sharing toggle — this just jumps the view to
  // where you are right now, nothing is written anywhere or kept running.
  const locateMe = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setMyLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude, seq: Date.now() }),
      () => {},
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )
  }

  // Switching days used to leave the map showing one day's pins with the
  // card carousel still on the previous day's stop — every day's stops were
  // generated with plain 1/2/3 ids, so day 1's stop 3 and day 2's stop 3
  // shared a literal id, and the check below found a "match" that was
  // actually a different place. Fixed at the source (itinerary.js scopes
  // the id to the day now), but changing day is a big enough context switch
  // to always start fresh regardless — not worth trusting every future id
  // scheme to stay collision-free.
  useEffect(() => { setActiveId(null) }, [activeDay])

  // The list beside the map (desktop) picked a stop.
  useEffect(() => { if (focusId != null) setActiveId(focusId) }, [focusId])

  const pick = (id) => {
    setActiveId(id)
    onFocusStop?.(id)
  }

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
  // Same reasoning as daySwitcher below — rendered regardless of whether the
  // active family happens to have stops for this day, since switching to a
  // family that hasn't planned yet is exactly when you'd want the switcher.
  const familySwitcher = families.length > 1 && (
    <div className="family-strip">
      <div className="hscroll">
        {families.map((f) => (
          <button
            key={f.id}
            className={`pill ${activeFamily === f.id ? 'on' : ''}`}
            onClick={() => switchFamily(f.id)}
          >
            <i className="dot" style={{ background: f.color, marginInlineEnd: 6 }} />
            {f.name}
          </button>
        ))}
      </div>
    </div>
  )

  const daySwitcher = dayList.length > 1 && (
    <div className="day-strip">
      <div className="hscroll">
        {dayList.map((d) => (
          <button
            key={d}
            className={`pill ${d === activeDay ? 'on' : ''}`}
            onClick={() => setActiveDay(d)}
          >
            {t('יום')} <span className="num">{d}</span>
            {(days[d]?.length ?? 0) > 0 && (
              <> · <span className="num">{days[d].length}</span> {tn(days[d].length, 'עצירה', 'עצירות')}</>
            )}
          </button>
        ))}
      </div>
    </div>
  )

  if (STOPS.length === 0) {
    return (
      <div className="map-screen" style={{ display: 'grid', placeItems: 'center' }}>
        {!embedded && (
          <>
            <div style={{ position: 'relative', zIndex: 10 }}>
              <TopBar floating />
            </div>
            {familySwitcher}
            {daySwitcher}
          </>
        )}
        <div className="card" style={{ textAlign: 'center', maxWidth: 300 }}>
          {planning ? (
            <>
              <span className="typing"><i /><i /><i /></span>
              <p className="sub" style={{ marginTop: 12 }}>{t('הסוכן בונה את המסלול...')}</p>
            </>
          ) : (
            <p className="sub">
              {unlocated > 0
                ? t('העצירות ביום הזה עדיין בלי מיקום על המפה — אפשר לערוך אותן ולבחור מקום מהרשימה.')
                : t('אין עדיין עצירות ביום הזה.')}
            </p>
          )}
        </div>
        {switcher && <div className="view-switch-wrap on-map">{switcher}</div>}
      </div>
    )
  }

  return (
    <div className="map-screen">
      <MapCanvas
        stops={STOPS}
        activeId={activeId}
        onPinClick={pick}
        provider={provider}
        hotels={locatedStays}
        people={livePeople}
        myLocation={myLoc}
        locateSignal={myLoc?.seq}
      />

      {!embedded && (
        <>
          <div style={{ position: 'relative', zIndex: 10 }}>
            <TopBar floating />
          </div>
          {familySwitcher}
          {daySwitcher}
        </>
      )}

      <div className={`map-tools ${embedded ? 'embedded' : ''}`}>
        <button className="map-tool" onClick={locateMe} aria-label={t('מרכז על המיקום שלי')}><Locate size={18} /></button>
        {/* Used to be a + with no handler at all — now it opens the list's
            add-a-stop form. */}
        {onAddStop && (
          <button className="map-tool" onClick={onAddStop} aria-label={t('הוסף עצירה')} title={t('הוסף עצירה')}>
            <Plus size={18} />
          </button>
        )}
        <button
          className={`map-tool ${sharingLocation ? 'on' : ''}`}
          onClick={toggleLocationSharing}
          aria-label={sharingLocation ? t('הפסק לשתף מיקום חי') : t('שתף מיקום חי עם הקבוצה')}
          aria-pressed={sharingLocation}
          title={t('מיקום חי')}
        >
          <MapPin size={18} />
        </button>
      </div>

      <div className={`stop-deck ${embedded ? 'single' : ''}`}>
        <div className="hscroll" ref={deckRef}>
          {(embedded ? STOPS.filter((s) => s.id === activeId) : STOPS).map((s) => {
            const on = s.id === activeId
            const cat = CATEGORIES[s.cat]
            return (
              <div
                key={s.id}
                data-stop={s.id}
                className={`stop-card glass ${on ? 'active' : ''}`}
                onClick={() => pick(s.id)}
              >
                <div className="between" style={{ marginBottom: 9 }}>
                  <span className="tiny row" style={{ gap: 5 }}>
                    <span className="num">{s.time}</span>
                    <Clock size={13} />
                  </span>
                  {s.rating ? <span className="star"><span className="num">{s.rating}</span><Star size={13} /></span> : null}
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
                    {t('ניווט')}
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
                      aria-label={t('פרטים על {place}', { place: s.he })}
                    >
                      <Info size={15} />
                    </button>
                  </span>
                </div>
              </div>
            )
          })}

          {/* The hotel is not one of today's stops — it doesn't belong to
              any one day — so it rides along at the end of every day's deck
              instead, reachable regardless of which stop you scrolled to. */}
          {!embedded && locatedStays.map((h) => (
            <div key={h.label} className="stop-card glass">
              <div className="between" style={{ marginBottom: 9 }}>
                <span className="tiny row" style={{ gap: 5 }}>
                  <Bed size={13} /> {t('המלון שלכם')}
                </span>
              </div>
              <h3 className="h3" style={{ fontSize: 16, marginBottom: 6 }}>{h.name}</h3>
              <p className="tiny" style={{ margin: '0 0 13px', minHeight: 34 }}>{h.label}</p>
              <a
                className="btn btn-primary btn-sm btn-block"
                href={navigateUrl(h.lat, h.lng, h.name)}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation size={15} />
                {t('ניווט למלון')}
              </a>
            </div>
          ))}
        </div>
      </div>

      {switcher && <div className="view-switch-wrap on-map">{switcher}</div>}

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
              {details.rating ? <span className="star"><Star size={14} /><span className="num">{details.rating}</span></span> : <span />}
              <span className="badge">{CATEGORIES[details.cat].label}</span>
            </div>
            <p className="sub" style={{ marginBottom: 16 }}>{details.desc}</p>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="between" style={{ marginBottom: 10 }}>
                <span className="tiny">{t('שעת הגעה מתוכננת')}</span>
                <strong className="num" style={{ fontSize: 14 }}>{details.time}</strong>
              </div>
              <div className="between">
                <span className="tiny">{t('קואורדינטות')}</span>
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
              {t('פתח ניווט ב-Google Maps')}
            </a>
          </>
        )}
      </Sheet>
    </div>
  )
}
