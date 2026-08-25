import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES } from '../data'
import { buildStaticMapUrl, hasMapsKey } from '../lib/staticMap'
import { PROVIDERS, TILE_SIZE, project, tileRange, tilesIn } from '../lib/tiles'

/**
 * Fallback viewport used to decide how many tiles to fetch, before the real
 * container has been measured. It used to be the only answer, which meant a
 * desktop — where the map stage is three times this wide — fetched a
 * phone-shaped strip of tiles and left blank ground either side of it.
 */
const VIEW = { width: 430, height: 932 }

/** Neighbourhood-level zoom: street names legible, a few blocks in frame. */
const ZOOM = 14

/** The active stop sits here in the frame — above centre, clear of the carousel. */
const FOCUS_Y = '42%'

/** Half-size of the square SVG overlay that carries the route and the pins. */
const HALF = 1024

/** 24x24 glyphs drawn inside each circular pin. */
const GLYPH = {
  museum: 'M3 9.5 12 4l9 5.5M4.5 10V18M9.5 10V18M14.5 10V18M19.5 10V18M3 21h18',
  landmark: 'M12 3v18M8.5 21h7M9.5 9.5h5M8 14.5h8',
  food: 'M4.5 3v7a3 3 0 0 0 3 3v8M7.5 3v6.5M10.5 3v6.5M18 3c-1.6 1.6-2.2 3.7-2.2 6.3 0 2 .8 3.7 2.2 3.7V21',
  walking: 'M13.4 4.6a1.7 1.7 0 1 1-.1-.1M10.6 21l2.2-6.2-2.6-2.6L9 16.4M8.4 9.6 12.6 7.8l3.2 1.6 2 3.2M12.8 15.2l3.2 5.8',
}

/** Same source as the Bed icon in Icons.jsx, kept inline rather than shared
 *  since every other pin glyph here is already a raw path string, not a
 *  component. */
const BED_GLYPH = [
  'M3 20V6M3 12h18a2 2 0 0 1 2 2v6M21 20v-3M3 16h18',
  'M7.5 12V9.5A1.5 1.5 0 0 1 9 8h9a3 3 0 0 1 3 3v1',
]

/** A long place name would otherwise stretch across half the map — one
 *  label is not allowed to compete with the map itself for space. */
const MAX_LABEL = 14
const clip = (s) => (s.length > MAX_LABEL ? `${s.slice(0, MAX_LABEL - 1)}…` : s)

/** Name label with a thin halo behind it, so it reads over any tile colour
 *  without needing to measure text width for a background rect. Sized to
 *  stay a caption next to the pin, not a headline over the map. */
function PinLabel({ x, y, text, color, bold }) {
  const shared = {
    x, y, textAnchor: 'middle', fontFamily: 'Rubik, Heebo, sans-serif',
    fontSize: bold ? 10 : 8.5, fontWeight: bold ? 700 : 600,
  }
  return (
    <g style={{ pointerEvents: 'none' }}>
      <text {...shared} stroke="#fff" strokeWidth="2.5" strokeLinejoin="round">{clip(text)}</text>
      <text {...shared} fill={color}>{clip(text)}</text>
    </g>
  )
}

/** Bowed legs, so the route reads as streets rather than a ruler line. */
function routePath(pts) {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]
    const c = pts[i]
    const bow = i % 2 ? 18 : -18
    d += ` Q ${(p.x + c.x) / 2 + bow} ${(p.y + c.y) / 2} ${c.x} ${c.y}`
  }
  return d
}

export default function MapCanvas({
  stops, activeId, onPinClick, provider = 'cartoLight', hotel, people = [],
  myLocation, locateSignal,
}) {
  const active = stops.find((s) => s.id === activeId) ?? stops[0]
  const src = PROVIDERS[provider] ?? PROVIDERS.cartoLight

  // Measure the frame rather than assuming a phone. Rounding to whole tiles
  // keeps this from re-fetching on every pixel of a window drag.
  const frame = useRef(null)
  const [view, setView] = useState(VIEW)

  // Manual drag, on top of the auto-centring transform below. The map used
  // to only move by snapping between stops — tapping a pin or swiping the
  // carousel — with no way to just look around. Bounded rather than a true
  // pannable map: tiles are fetched around the day's stops plus half a
  // viewport of margin (tileRange in lib/tiles.js), not dynamically as you
  // drag, so panning past that would run onto blank ground with nothing
  // there. The clamp keeps it inside what is actually loaded.
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef(null)

  // A different stop becoming active is a deliberate "go there" — it should
  // win over wherever a free drag happened to leave the view.
  useEffect(() => { setPan({ x: 0, y: 0 }) }, [activeId])

  const clampPan = (p) => {
    const maxX = view.width * 0.4
    const maxY = view.height * 0.4
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    }
  }

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return
    drag.current = { startX: e.clientX, startY: e.clientY, startPan: pan, moved: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    // A few pixels of slop before this counts as a drag rather than a tap —
    // otherwise every pin click would nudge the map by a pixel first.
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    setPan(clampPan({ x: d.startPan.x + dx, y: d.startPan.y + dy }))
  }

  const endDrag = () => { drag.current = null }

  useEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (!width || !height) return
      setView((prev) => {
        const snap = (n) => Math.ceil(n / TILE_SIZE) * TILE_SIZE
        const next = { width: snap(width), height: snap(height) }
        return next.width === prev.width && next.height === prev.height ? prev : next
      })
    })

    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(() => {
    // The frame follows one stop at a time, so zoom is a design constant rather
    // than something fitted to the whole route — fitting all of Paris lands on
    // z12, where the streets are unreadable. (tiles.js exports fitZoom if you
    // ever switch to framing the entire itinerary at once.)
    const z = Math.min(ZOOM, src.maxZoom)

    const pts = stops.map((s) => ({ ...s, ...project(s.lat, s.lng, z) }))

    // Anchor the layout on the itinerary centroid and animate only the
    // container transform, so tile elements are positioned once.
    const anchor = {
      x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
      y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
    }
    const spread = {
      x: Math.max(...pts.map((p) => Math.abs(p.x - anchor.x))),
      y: Math.max(...pts.map((p) => Math.abs(p.y - anchor.y))),
    }

    return { z, pts, anchor, tiles: tilesIn(tileRange(anchor, spread, view, z)) }
  }, [stops, src.maxZoom, view])

  const { z, pts, anchor, tiles } = layout
  const center = project(active.lat, active.lng, z)
  const shift = { x: anchor.x - center.x, y: anchor.y - center.y }

  // "Locate me" reuses the pan mechanism rather than moving the anchor
  // itself — the active stop stays the frame's real centre, this only
  // nudges the view the same way a manual drag would, and inherits the
  // same clamp (so it degrades to "as close as the loaded tiles allow"
  // rather than breaking when the real position is far from today's stops).
  useEffect(() => {
    if (!myLocation || locateSignal == null) return
    const gps = project(myLocation.lat, myLocation.lng, z)
    setPan(clampPan({ x: center.x - gps.x, y: center.y - gps.y }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateSignal])

  // Overlay coordinates, relative to the anchor.
  const local = pts.map((p) => ({ ...p, x: HALF + (p.x - anchor.x), y: HALF + (p.y - anchor.y) }))

  // The hotel is not part of the anchor/zoom fit above — it stays wherever it
  // really is, even off in a corner, rather than pulling the day's frame out
  // to a zoom where the streets stop being legible just to fit a stop nobody
  // asked to see zoomed out for. It's still projected and drawn every time.
  const hotelLocal =
    hotel?.lat != null && hotel?.lng != null
      ? (() => {
          const p = project(hotel.lat, hotel.lng, z)
          return { x: HALF + (p.x - anchor.x), y: HALF + (p.y - anchor.y) }
        })()
      : null

  const myLocationLocal =
    myLocation?.lat != null && myLocation?.lng != null
      ? (() => {
          const p = project(myLocation.lat, myLocation.lng, z)
          return { x: HALF + (p.x - anchor.x), y: HALF + (p.y - anchor.y) }
        })()
      : null

  // Same off-anchor treatment as the hotel — wherever someone actually is,
  // not folded into the zoom fit for the day's stops.
  const peopleLocal = people
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => {
      const proj = project(p.lat, p.lng, z)
      return { ...p, x: HALF + (proj.x - anchor.x), y: HALF + (proj.y - anchor.y) }
    })

  // A Google key, if one is ever supplied, takes precedence.
  const googleUrl = useMemo(() => {
    if (!hasMapsKey) return null
    return buildStaticMapUrl({
      center: [active.lat, active.lng],
      zoom: 14,
      size: '640x640',
      scale: 2,
      markers: stops.map((s, i) => ({
        lat: s.lat,
        lng: s.lng,
        label: String(i + 1),
        color: CATEGORIES[s.cat].color.replace('#', '0x'),
      })),
      pathPoints: stops.map((s) => [s.lat, s.lng]),
    })
  }, [active.lat, active.lng, stops])

  if (googleUrl) {
    return (
      <div className="map-canvas">
        <img
          src={googleUrl}
          alt={`מפת המסלול, ${stops.length} עצירות, ממוקדת על ${active.he}`}
          width={640}
          height={640}
          loading="lazy"
          style={{ objectFit: 'cover' }}
        />
      </div>
    )
  }

  return (
    <div
      className="map-canvas"
      ref={frame}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="map-pan"
        style={{
          transform: `translate(${shift.x + pan.x}px, ${shift.y + pan.y}px)`,
          // No snap-animation while actively dragging — the map should
          // follow the finger immediately, not glide half a second behind.
          transition: drag.current?.moved ? 'none' : undefined,
        }}
        role="img"
        aria-label={`מפת המסלול, ${stops.length} עצירות, ממוקדת על ${active.he}`}
      >
        {tiles.map((t) => (
          <img
            key={`${t.x}/${t.y}`}
            className="map-tile"
            src={src.url(z, t.x, t.y, true)}
            width={TILE_SIZE}
            height={TILE_SIZE}
            alt=""
            aria-hidden="true"
            draggable="false"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
            style={{
              insetInlineStart: `calc(50% + ${t.x * TILE_SIZE - anchor.x}px)`,
              top: `calc(${FOCUS_Y} + ${t.y * TILE_SIZE - anchor.y}px)`,
            }}
          />
        ))}

        <svg
          className="map-overlay"
          width={HALF * 2}
          height={HALF * 2}
          viewBox={`0 0 ${HALF * 2} ${HALF * 2}`}
          style={{
            insetInlineStart: `calc(50% - ${HALF}px)`,
            top: `calc(${FOCUS_Y} - ${HALF}px)`,
          }}
        >
          <defs>
            <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="pinShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0A0A16" floodOpacity="0.28" />
            </filter>
          </defs>

          <path d={routePath(local)} stroke="var(--accent)" strokeWidth="10" fill="none"
                strokeLinecap="round" opacity="0.22" filter="url(#glow)" />
          <path d={routePath(local)} stroke="var(--accent)" strokeWidth="3" fill="none"
                strokeLinecap="round" strokeDasharray="1 10" opacity="0.95" />

          {local.map((s, i) => {
            const color = CATEGORIES[s.cat].color
            const on = s.id === activeId
            return (
              <g
                key={s.id}
                className={`map-pin ${on ? 'active' : ''}`}
                onClick={() => onPinClick?.(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onPinClick?.(s.id)}
                aria-label={`${s.he}, עצירה ${i + 1}`}
              >
                {on && (
                  <circle cx={s.x} cy={s.y} r="24" fill={color} opacity="0.18">
                    <animate attributeName="r" values="17;30;17" dur="2.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.32;0.02;0.32" dur="2.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <g filter="url(#pinShadow)">
                  <circle cx={s.x} cy={s.y} r="16" fill={color}
                          stroke="#fff" strokeWidth={on ? 2 : 1.2} />
                  <g
                    transform={`translate(${s.x - 8} ${s.y - 8}) scale(0.667)`}
                    fill="none" stroke="#fff" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: 'none' }}
                  >
                    <path d={GLYPH[s.cat]} />
                  </g>
                </g>
                <PinLabel x={s.x} y={s.y - 24} text={s.he} color={on ? color : 'var(--text-2, #43424F)'} bold={on} />
              </g>
            )
          })}

          {hotelLocal && (
            // Not a stop — nothing to select, so no click handler or pin
            // affordances, just a marker that is always on the map.
            <g role="img" aria-label={`מלון: ${hotel.name}`}>
              {/* Unlike a stop's pulse, this glow never turns off — the hotel
                  is the one point on the map that matters regardless of
                  which stop happens to be active. */}
              <circle cx={hotelLocal.x} cy={hotelLocal.y} r="26" fill="var(--gold, #A0783F)" opacity="0.22">
                <animate attributeName="r" values="20;30;20" dur="3s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0.12;0.3" dur="3s" repeatCount="indefinite" />
              </circle>
              <g filter="url(#pinShadow)">
                <circle cx={hotelLocal.x} cy={hotelLocal.y} r="19" fill="var(--gold, #A0783F)"
                        stroke="#fff" strokeWidth="2.5" />
                <g
                  transform={`translate(${hotelLocal.x - 9.5} ${hotelLocal.y - 9.5}) scale(0.79)`}
                  fill="none" stroke="#fff" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: 'none' }}
                >
                  {BED_GLYPH.map((d) => <path key={d} d={d} />)}
                </g>
              </g>
              <PinLabel x={hotelLocal.x} y={hotelLocal.y - 28} text={hotel.name} color="var(--gold, #A0783F)" bold />
            </g>
          )}

          {myLocationLocal && (
            // Google Maps' own convention for "this device, right now" — kept
            // visually distinct from the green live-shared dots above, which
            // are other people (or this device on a much slower cadence).
            <g role="img" aria-label="המיקום שלך">
              <circle cx={myLocationLocal.x} cy={myLocationLocal.y} r="13" fill="#4285F4" opacity="0.25">
                <animate attributeName="r" values="10;18;10" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.06;0.35" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={myLocationLocal.x} cy={myLocationLocal.y} r="7" fill="#4285F4" stroke="#fff" strokeWidth="2.5" />
            </g>
          )}

          {peopleLocal.map((p) => (
            <g key={p.id} role="img" aria-label={`מיקום חי: ${p.name ?? 'מישהו'}`}>
              <circle cx={p.x} cy={p.y} r="16" fill="var(--emerald, #10B981)" opacity="0.28">
                <animate attributeName="r" values="12;20;12" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.4;0.08;0.4" dur="1.8s" repeatCount="indefinite" />
              </circle>
              <g filter="url(#pinShadow)">
                <circle cx={p.x} cy={p.y} r="11" fill="var(--emerald, #10B981)" stroke="#fff" strokeWidth="2.2" />
                <text
                  x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                  fontFamily="Rubik, Heebo, sans-serif" fontSize="10" fontWeight="700" fill="#fff"
                >
                  {(p.name ?? '?').trim().charAt(0)}
                </text>
              </g>
              <PinLabel x={p.x} y={p.y - 19} text={p.name ?? 'מישהו'} color="var(--emerald, #10B981)" />
            </g>
          ))}
        </svg>
      </div>

      {/* Attribution is a licence condition of the tile providers. */}
      <span className="map-attribution">{src.attribution}</span>
    </div>
  )
}
