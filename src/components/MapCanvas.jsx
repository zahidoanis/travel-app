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

export default function MapCanvas({ stops, activeId, onPinClick, provider = 'cartoLight' }) {
  const active = stops.find((s) => s.id === activeId) ?? stops[0]
  const src = PROVIDERS[provider] ?? PROVIDERS.cartoLight

  // Measure the frame rather than assuming a phone. Rounding to whole tiles
  // keeps this from re-fetching on every pixel of a window drag.
  const frame = useRef(null)
  const [view, setView] = useState(VIEW)

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

  // Overlay coordinates, relative to the anchor.
  const local = pts.map((p) => ({ ...p, x: HALF + (p.x - anchor.x), y: HALF + (p.y - anchor.y) }))

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
    <div className="map-canvas" ref={frame}>
      <div
        className="map-pan"
        style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}
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
              </g>
            )
          })}
        </svg>
      </div>

      {/* Attribution is a licence condition of the tile providers. */}
      <span className="map-attribution">{src.attribution}</span>
    </div>
  )
}
