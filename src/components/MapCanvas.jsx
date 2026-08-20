import { useMemo } from 'react'
import { CATEGORIES } from '../data'
import { buildStaticMapUrl, hasMapsKey } from '../lib/staticMap'

const VB_W = 430
const VB_H = 760

/** 24x24 glyphs drawn inside each circular pin. */
const GLYPH = {
  museum: 'M3 9.5 12 4l9 5.5M4.5 10V18M9.5 10V18M14.5 10V18M19.5 10V18M3 21h18',
  landmark: 'M12 3v18M8.5 21h7M9.5 9.5h5M8 14.5h8',
  food: 'M4.5 3v7a3 3 0 0 0 3 3v8M7.5 3v6.5M10.5 3v6.5M18 3c-1.6 1.6-2.2 3.7-2.2 6.3 0 2 .8 3.7 2.2 3.7V21',
  walking: 'M13.4 4.6a1.7 1.7 0 1 1-.1-.1M10.6 21l2.2-6.2-2.6-2.6L9 16.4M8.4 9.6 12.6 7.8l3.2 1.6 2 3.2M12.8 15.2l3.2 5.8',
}

/** Smooth route through the stops — bowed legs so it reads like streets. */
function routePath(stops) {
  if (stops.length < 2) return ''
  let d = `M ${stops[0].x} ${stops[0].y}`
  for (let i = 1; i < stops.length; i++) {
    const p = stops[i - 1]
    const c = stops[i]
    const bow = i % 2 ? 26 : -26
    d += ` Q ${(p.x + c.x) / 2 + bow} ${(p.y + c.y) / 2} ${c.x} ${c.y}`
  }
  return d
}

const STREETS = [
  'M -40 120 L 470 60', 'M -40 250 L 470 200', 'M -40 640 L 470 592',
  'M 60 -20 L 130 780', 'M 210 -20 L 250 780', 'M 350 -20 L 372 780',
  'M -40 430 L 470 470', 'M 0 780 L 470 300', 'M -40 30 L 300 780',
]

const BLOCKS = [
  [30, 90, 120, 90], [180, 60, 90, 130], [300, 110, 110, 90],
  [40, 300, 100, 110], [180, 330, 120, 80], [320, 300, 90, 120],
  [60, 480, 130, 100], [230, 500, 100, 110], [340, 470, 80, 90],
  [90, 650, 120, 90], [250, 660, 110, 80],
]

export default function MapCanvas({ stops, activeId, onPinClick }) {
  const active = stops.find((s) => s.id === activeId) ?? stops[0]

  // Pan so the active pin sits above the visual centre, clear of the carousel.
  const pan = useMemo(
    () => ({ x: VB_W / 2 - active.x, y: VB_H * 0.4 - active.y }),
    [active.x, active.y]
  )

  // With a real key, Google renders the map and we recentre it on the active
  // stop. Coordinates are rounded in buildStaticMapUrl, so revisiting a stop
  // reuses the cached image rather than costing another request.
  const staticUrl = useMemo(() => {
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
    })
  }, [active.lat, active.lng, stops])

  if (staticUrl) {
    return (
      <div className="map-canvas">
        <img
          src={staticUrl}
          alt={`מפת המסלול היומי בפריז, ${stops.length} עצירות, ממוקדת על ${active.he}`}
          width={640}
          height={640}
          loading="lazy"
          style={{ objectFit: 'cover' }}
        />
      </div>
    )
  }

  return (
    <div className="map-canvas">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`מפת המסלול היומי בפריז, ${stops.length} עצירות, ממוקדת על ${active.he}`}
      >
        <defs>
          <linearGradient id="seine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0A2530" />
            <stop offset="100%" stopColor="#0C3947" />
          </linearGradient>
          <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="pinShadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.7" />
          </filter>
        </defs>

        <rect width={VB_W} height={VB_H} fill="#0A0B12" />

        <g
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            transition: 'transform 0.62s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <g opacity="0.55">
            {BLOCKS.map(([x, y, w, h], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} rx="8" fill="#141426" />
            ))}
          </g>

          {/* the Seine */}
          <path
            d="M -60 470 C 60 430, 150 520, 250 480 S 420 400, 500 430 L 500 500 C 420 470, 330 555, 250 545 S 60 500, -60 540 Z"
            fill="url(#seine)"
          />

          <g stroke="#20223A" strokeWidth="2.4" strokeLinecap="round" opacity="0.9">
            {STREETS.map((d, i) => <path key={i} d={d} />)}
          </g>
          <g stroke="#2C2F4E" strokeWidth="4.5" strokeLinecap="round" opacity="0.75">
            <path d="M -40 380 L 470 340" />
            <path d="M 150 -20 L 190 780" />
          </g>

          {/* glowing route */}
          <path d={routePath(stops)} stroke="#22D3EE" strokeWidth="9" fill="none"
                strokeLinecap="round" opacity="0.2" filter="url(#glow)" />
          <path d={routePath(stops)} stroke="#67E8F9" strokeWidth="2.6" fill="none"
                strokeLinecap="round" strokeDasharray="1 10" opacity="0.95" />

          {/* circular category pins */}
          {stops.map((s, i) => {
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
                          stroke="rgba(255,255,255,0.7)" strokeWidth={on ? 2 : 1.2} />
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

          {/* current location */}
          <g>
            <circle cx="108" cy="628" r="14" fill="#6366F1" opacity="0.2">
              <animate attributeName="r" values="9;20;9" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.35;0;0.35" dur="2.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="108" cy="628" r="6" fill="#6366F1" stroke="#fff" strokeWidth="2.2" />
          </g>
        </g>
      </svg>
    </div>
  )
}
