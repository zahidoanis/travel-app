/**
 * Inline SVG icon set — lucide-shaped paths, zero dependencies.
 * Every icon takes { size, ...rest } and inherits `currentColor`.
 */

const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
})

const make = (paths) =>
  function Icon({ size = 20, ...rest }) {
    return (
      <svg {...base(size)} {...rest}>
        {paths}
      </svg>
    )
  }

/* ---- navigation ---- */
export const Calendar = make(
  <>
    <rect x="3" y="4" width="18" height="18" rx="3" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>
)
export const MapIcon = make(
  <>
    <path d="M15 6.5 9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5Z" />
    <path d="M9 4v13M15 6.5v13" />
  </>
)
export const Bot = make(
  <>
    <rect x="3" y="8" width="18" height="12" rx="4" />
    <path d="M12 4v4M2 14h1M21 14h1" />
    <circle cx="9" cy="14" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14" r="1.1" fill="currentColor" stroke="none" />
  </>
)
export const Images = make(
  <>
    <rect x="7" y="3" width="14" height="14" rx="3" />
    <circle cx="11.5" cy="8" r="1.4" />
    <path d="m21 13-3.5-3.5L11 16" />
    <path d="M17 21H6a3 3 0 0 1-3-3V7" />
  </>
)
export const Wallet = make(
  <>
    <path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6" />
    <circle cx="16.5" cy="14" r="1.2" fill="currentColor" stroke="none" />
  </>
)

/* ---- chrome ---- */
export const Bell = make(
  <>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8Z" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
  </>
)
export const CloudSun = make(
  <>
    <path d="M12 2v2M4.9 4.9l1.4 1.4M2 12h2M19.1 4.9l-1.4 1.4" />
    <path d="M9.4 8.6a4 4 0 1 1 5.6 5" />
    <path d="M6 20h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.7 1.2A3 3 0 0 0 6 20Z" />
  </>
)
export const ArrowRight = make(<path d="M5 12h14M13 6l6 6-6 6" />)
export const ArrowLeft = make(<path d="M19 12H5M11 18l-6-6 6-6" />)
export const Check = make(<path d="m4.5 12.5 5 5 10-11" />)
export const X = make(<path d="M18 6 6 18M6 6l12 12" />)
export const Plus = make(<path d="M12 5v14M5 12h14" />)
export const Mic = make(
  <>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 11a7 7 0 0 1-14 0M12 18v4M8 22h8" />
  </>
)
export const Send = make(<path d="M21 3 3 10.5l7 3 3 7L21 3Z" />)
export const Paperclip = make(
  <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.4 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
)
export const Sparkles = make(
  <>
    <path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7 10.4 11.2 6 9.6 10.4 8 12 3.5Z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
  </>
)
export const Star = make(
  <path
    d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.6Z"
    fill="currentColor"
    stroke="none"
  />
)
export const Info = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4.5M12 8h.01" />
  </>
)
export const Navigation = make(
  <path d="M3.5 10.7 21 3.5l-7.2 17.5-2.4-7.4-7.9-2.9Z" />
)
export const Play = make(<path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none" />)
export const RefreshCw = make(
  <>
    <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16" />
    <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8" />
    <path d="M21 3v5h-5M3 21v-5h5" />
  </>
)
export const ArrowUpDown = make(<path d="M7 3v18M7 3 3.5 6.5M7 3l3.5 3.5M17 21V3M17 21l3.5-3.5M17 21l-3.5-3.5" />)
export const Receipt = make(
  <>
    <path d="M5 21V4.2a1 1 0 0 1 1.5-.9L9 4.6l2.6-1.3a1 1 0 0 1 .9 0L15 4.6l2.5-1.3a1 1 0 0 1 1.5.9V21l-3-1.6-3 1.6-3-1.6L5 21Z" />
    <path d="M9 8.5h6M9 12.5h6" />
  </>
)
export const Users = make(
  <>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3.4" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.9M16.5 3.6a4 4 0 0 1 0 7" />
  </>
)
export const Train = make(
  <>
    <rect x="5" y="3" width="14" height="13" rx="3" />
    <path d="M5 10h14M8 20l-2 2M16 20l2 2M7 16.5h.01M17 16.5h.01" />
  </>
)
export const Plane = make(
  <path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.5.5 0 0 0-.5.8L8.5 11l-2 2H4l-.7 1.4 3.3 2 2 3.3L10 18v-2.5l2-2 3.9 4.2a.5.5 0 0 0 .9-.5Z" />
)
export const AlertTriangle = make(
  <>
    <path d="M10.3 4.3 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4M12 17h.01" />
  </>
)
export const Clock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5.2l3.2 1.9" />
  </>
)
export const MapPin = make(
  <>
    <path d="M20 10.5c0 5.6-8 12-8 12s-8-6.4-8-12a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10.3" r="2.8" />
  </>
)
export const Layers = make(
  <>
    <path d="m12 2.5 9.5 5-9.5 5-9.5-5 9.5-5Z" />
    <path d="m2.5 12 9.5 5 9.5-5M2.5 16.5l9.5 5 9.5-5" />
  </>
)
export const Locate = make(
  <>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </>
)
export const Music = make(
  <>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.2" cy="18" r="2.8" />
    <circle cx="17.2" cy="16" r="2.8" />
  </>
)
export const Utensils = make(
  <>
    <path d="M4 3v7a3 3 0 0 0 3 3v8M7 3v6M10 3v6" />
    <path d="M17.5 3c-1.5 1.5-2 3.5-2 6s.7 3.5 2 3.5V21" />
  </>
)
export const Landmark = make(
  <>
    <path d="M3 9.5 12 4l9 5.5M4.5 9.5V18M9.5 9.5V18M14.5 9.5V18M19.5 9.5V18M3 21h18" />
  </>
)
export const Footprints = make(
  <>
    <path d="M6 20.5c-1.6 0-2.6-1.1-2.6-3 0-1.6.6-2.1.6-4.1S3.2 9 5.2 8.6 8.3 10.2 8.3 12.2s-.6 3.1-.6 5.2 0 3.1-1.7 3.1Z" />
    <path d="M17.9 16.4c1.6 0 2.6-1.1 2.6-3 0-1.6-.6-2.1-.6-4.1s.8-4.4-1.2-4.8-3.1 1.6-3.1 3.6.6 3.1.6 5.2 0 3.1 1.7 3.1Z" />
  </>
)
export const Bookmark = make(<path d="M18 21 12 17l-6 4V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16Z" />)
export const Sun = make(
  <>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </>
)
export const Video = make(
  <>
    <rect x="2" y="6" width="14" height="12" rx="3" />
    <path d="m16 10.5 6-3.5v10l-6-3.5" />
  </>
)
export const Sliders = make(
  <path d="M4 20v-6M4 10V4M12 20v-9M12 7V4M20 20v-4M20 12V4M1.5 14h5M9.5 7h5M17.5 16h5" />
)
export const WhatsApp = make(
  <>
    <path d="M3.2 20.8 4.5 16.4A8.6 8.6 0 1 1 7.8 19.7l-4.6 1.1Z" />
    <path d="M8.9 8c.3 0 .5.1.6.4l.7 1.6c.1.3 0 .5-.2.7l-.5.5c-.2.2-.2.4-.1.6a6.2 6.2 0 0 0 2.9 2.7c.2.1.5 0 .6-.1l.6-.7c.2-.2.4-.3.7-.2l1.6.8c.3.1.4.4.3.7-.2.9-1 1.5-1.9 1.5-2.9 0-6.4-3.5-6.4-6.4 0-.9.6-1.7 1.5-1.9L8.9 8Z" />
  </>
)
export const Share = make(
  <>
    <circle cx="18" cy="5.5" r="2.8" />
    <circle cx="6" cy="12" r="2.8" />
    <circle cx="18" cy="18.5" r="2.8" />
    <path d="m8.5 10.7 7-3.4M8.5 13.3l7 3.4" />
  </>
)
export const Copy = make(
  <>
    <rect x="9" y="9" width="12" height="12" rx="3" />
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
  </>
)
export const Link = make(
  <>
    <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </>
)
export const Filter = make(<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" />)
