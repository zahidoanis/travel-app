# Design Prompt — Travel App with Google Static Maps

## Role
You are a senior product designer + frontend engineer. Design and build the UI for a
travel-planning app where **every map is a Google Static Maps image** (no interactive
JS map SDK). Maps are rendered server-side as `<img>` URLs.

## Core constraint: Google Static Maps API
Base endpoint:
`https://maps.googleapis.com/maps/api/staticmap?...&key=YOUR_API_KEY`

Rules the design MUST respect:
- The map is a **flat raster image**. No pan, no zoom, no hover, no click-to-drag.
  Any interactivity must be built *around* the image (buttons that swap the URL,
  overlaying HTML on top, opening Google Maps in a new tab on tap).
- Max free size is `640x640`; use `scale=2` for retina (renders 1280x1280, still billed
  as one image). Always set `scale=2` and CSS-size the img to the logical dimensions.
- Every map request costs money and is cached poorly if the URL changes. Build URLs
  **deterministically** so identical views hit the browser/CDN cache.
- Center/zoom must be chosen explicitly, or use `visible=` with multiple points to let
  Google auto-fit the bounds. Prefer `visible=` for multi-stop itineraries.
- Markers: `markers=color:0x1E88E5|label:1|32.0853,34.7818` — labels are limited to a
  single uppercase letter or digit. Design around that limit (use 1–9 / A–Z, and put the
  real name in the list beside the map, not on the pin).
- Routes: `path=weight:4|color:0x1E88E5CC|enc:<encoded_polyline>` using the encoded
  polyline from the Directions API. Encode it, don't pass hundreds of raw lat/lngs.
- Custom pin icons: `markers=icon:https://.../pin.png|...` — the icon must be a
  **publicly reachable HTTPS URL**, ≤ 4096 px total, PNG/JPEG/GIF.
- Styling: pass `style=` params to match the app's palette (e.g. hide POIs, desaturate
  land, tint water). Keep one shared style string in a constant so all maps look identical.
- URL length hard limit is 16,384 characters — long routes must be simplified.

## What to design
1. **Trip overview card** — hero static map showing all stops auto-fitted via `visible=`,
   numbered markers, styled route polyline. Below it: the numbered stop list that maps
   1:1 to the pin labels.
2. **Day view** — one static map per day, tighter zoom, only that day's markers, with a
   horizontal scroller of stop cards under it.
3. **Place detail** — small square static map (`200x200`, `zoom=15`, single marker),
   tappable, opens `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`.
4. **Empty / loading / error states** — a skeleton with the exact aspect ratio of the map,
   plus a graceful fallback block when the image 403s (bad key, quota, referrer block).
5. **Dark mode** — a second `style=` string producing a dark map; swap by
   `prefers-color-scheme`, and preload both so the switch isn't a white flash.

## Visual direction
- Clean, editorial travel aesthetic. Generous whitespace, one accent color that also
  drives the marker + polyline colors so map and UI feel like one system.
- Type: one display face for place names, one neutral UI face. Clear hierarchy.
- Cards with soft radii (12–16px) and low-contrast borders instead of heavy shadows.
- The map image should be treated as a first-class visual element: full-bleed at the top
  of the overview, rounded and inset elsewhere.
- Fully responsive; on mobile the map is 16:9 or 4:3, on desktop up to 2:1.
- Accessible: every map `<img>` needs a real `alt` describing the route
  ("Map of day 2: Tel Aviv to Jerusalem, 4 stops"), AA contrast, focus rings on
  everything tappable.

## Engineering deliverables
- A single `buildStaticMapUrl(options)` helper that is the ONLY place a map URL is
  constructed. Options: `center`, `zoom`, `size`, `scale`, `markers[]`, `path`,
  `visible[]`, `mapType`, `theme`. It applies the shared `style=` and appends the key.
- Never inline the API key in client source — read it from env, and restrict the key by
  HTTP referrer in Google Cloud Console.
- `loading="lazy"` + explicit `width`/`height` on every map img to avoid layout shift.
- Memoize/normalize coordinates (round to 5 decimals) so the same view produces the same
  URL and gets cached.

## Output
Produce: (a) the component structure, (b) the design tokens (color/type/spacing/radius),
(c) working code for the screens above with real static-map URLs, using placeholder
coordinates for a sample 3-day trip. Show light and dark side by side.
