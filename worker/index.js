/**
 * TripAI — Gemini proxy on Cloudflare Workers.
 *
 * Keeps the API key server-side so it never reaches the browser bundle, and
 * streams Gemini's SSE response straight through. The Workers free plan covers
 * 100,000 requests/day and needs no credit card.
 *
 * Deploy:
 *   npm install -g wrangler
 *   wrangler login
 *   wrangler secret put GEMINI_API_KEY
 *   wrangler deploy
 *
 * Then point the app at it:
 *   VITE_AI_PROXY_URL=https://<name>.<subdomain>.workers.dev
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'
// gemini-2.5-flash still appears in the models listing but returns 404 for
// new API keys; Google's own error points here instead.
const DEFAULT_MODEL = 'gemini-3.6-flash'

/** Only these origins may call the proxy. Set ALLOWED_ORIGINS in wrangler.toml. */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // With nothing configured, fall back to same-origin only (no CORS headers).
  const ok = allowed.length === 0 ? false : allowed.includes(origin)

  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }
    // Geocoding proxy.
    //
    // Nominatim refuses requests without an identifying User-Agent, and a
    // browser cannot set that header — the fetch is rejected 403 before it
    // starts. Doing the lookup here satisfies their policy and gives us one
    // place to hold the contact address they ask for.
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/geocode') {
      const q = url.searchParams.get('q')
      if (!q) return json({ error: { message: 'missing q' } }, 400, cors)

      // Autocomplete needs several candidates; a single lookup needs one.
      const limit = Math.min(8, Math.max(1, Number(url.searchParams.get('limit')) || 1))
      const params = {
        q,
        format: 'json',
        limit: String(limit),
        addressdetails: '1',
      }

      // Narrows autocomplete to places rather than shops with the same name.
      // `featuretype` is a Nominatim-only parameter — Photon does not read
      // it and silently ignored the filter entirely, which is how a "city"
      // search was returning bus stops. cityOnly carries the same intent
      // through to fromPhoton() below, in Photon's own filter syntax.
      const kind = url.searchParams.get('kind')
      const cityOnly = kind === 'city'
      if (cityOnly) params.featuretype = 'settlement'
      params['accept-language'] = 'en'

      // `details=1` asks for the contact information a booking needs — phone,
      // website, opening hours. Only Nominatim carries those tags, and the
      // call is rare enough that its rate limit is not a problem here.
      if (url.searchParams.get('details') === '1') {
        const detailed = await fromNominatim(
          { ...params, extratags: '1', namedetails: '1' },
          env
        )
        if (detailed === null) {
          return json({ error: { message: 'geocoder unavailable' } }, 502, cors)
        }
        return json(detailed, 200, {
          ...cors,
          'Cache-Control': detailed.length > 0 ? 'public, max-age=86400' : 'no-store',
        })
      }

      // Photon first: same OpenStreetMap data, but built for search-as-you-type
      // and — the part that matters here — it does not throttle Cloudflare's
      // shared egress IPs the way Nominatim does. Nominatim answered 502 for
      // most lookups from this worker while Photon returned all of them.
      let hits = await fromPhoton(q, limit, cityOnly)

      // Nominatim stays as the fallback so one provider being down is not an
      // outage, and because it handles some address-shaped queries better.
      if (hits === null || hits.length === 0) {
        const viaNominatim = await fromNominatim(params, env)
        if (viaNominatim !== null) hits = viaNominatim
      }

      if (hits === null) {
        return json({ error: { message: 'geocoder unavailable' } }, 502, cors)
      }

      return json(hits, 200, {
        ...cors,
        // Cache hits, never misses. An empty result is more often a throttle
        // than a place that does not exist, and caching it makes one blocked
        // lookup look permanent for the next 24 hours.
        'Cache-Control': hits.length > 0 ? 'public, max-age=86400' : 'no-store',
      })
    }

    // Liveness probe. Reveals nothing secret — only whether the key is
    // present — so deployment can be verified without spending Gemini quota.
    if (request.method === 'GET') {
      return json(
        {
          ok: true,
          service: 'tripai-ai',
          model: DEFAULT_MODEL,
          keyConfigured: Boolean(env.GEMINI_API_KEY),
          allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean).length,
        },
        200,
        cors
      )
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors })
    }
    if (!env.GEMINI_API_KEY) {
      return json({ error: { message: 'GEMINI_API_KEY is not configured' } }, 500, cors)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: { message: 'Invalid JSON body' } }, 400, cors)
    }

    // Take only the fields we intend to forward — never let a caller smuggle
    // through arbitrary request parameters.
    const model = typeof body.model === 'string' ? body.model : DEFAULT_MODEL
    if (!/^[a-zA-Z0-9.\-_]+$/.test(model)) {
      return json({ error: { message: 'Invalid model name' } }, 400, cors)
    }

    const forwarded = {
      contents: Array.isArray(body.contents) ? body.contents.slice(-24) : [],
      systemInstruction: body.systemInstruction,
      generationConfig: {
        temperature: 0.7,
        // Thinking tokens count against this budget and Gemini 3 spends several
        // hundred of them, so 800 leaves almost nothing for the actual answer.
        maxOutputTokens: 2048,
        ...(body.generationConfig ?? {}),
      },
    }

    if (forwarded.contents.length === 0) {
      return json({ error: { message: 'No contents supplied' } }, 400, cors)
    }

    const upstream = await fetch(
      // Trim and encode: piping a secret in from a shell easily leaves a
      // trailing newline, which produces an opaque "API key not valid" from
      // Google rather than anything pointing at the real cause.
      `${API}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
        env.GEMINI_API_KEY.trim()
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(forwarded),
      }
    )

    if (!upstream.ok) {
      const text = await upstream.text()
      return new Response(text, {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(upstream.body, {
      headers: {
        ...cors,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  },
}

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

/** Photon returns GeoJSON; normalise it to the shape the app expects. */
async function fromPhoton(q, limit, cityOnly) {
  try {
    const params = new URLSearchParams({ q, limit: String(limit), lang: 'en' })
    // Verified live: without this, "פאפוס" (Paphos, typed in Hebrew) matched
    // bus stops in Shefa-'Amr — Photon has no Hebrew name for a city this
    // size and fuzzy-matches to whatever scores closest, silently. "city"
    // alone was too narrow the other way — it excluded Positano and matched
    // Hallstatt to Halmstad, Sweden — so all three settlement tiers go in.
    // Repeated osm_tag params OR together rather than requiring all three.
    // On the Hebrew query this now returns nothing instead of a wrong place,
    // which is what lets the Nominatim fallback below actually run — its
    // search resolves that same query correctly.
    if (cityOnly) {
      for (const tag of ['place:city', 'place:town', 'place:village']) params.append('osm_tag', tag)
    }

    const res = await fetch(
      `https://photon.komoot.io/api/?${params}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null

    const { features = [] } = await res.json()

    return features.map((f) => {
      const p = f.properties ?? {}
      const [lng, lat] = f.geometry?.coordinates ?? []
      const place = p.city ?? p.town ?? p.village ?? p.county ?? ''

      return {
        lat,
        lng,
        name: p.name ?? [p.street, p.housenumber].filter(Boolean).join(' ') ?? '',
        // Build the address from parts — Photon has no single display string.
        label: [p.name, p.street, place, p.state, p.country].filter(Boolean).join(', '),
        city: place,
        country: p.country ?? '',
        type: p.osm_value ?? p.type ?? '',
      }
    })
  } catch {
    return null
  }
}

/** Nominatim fallback. Requires the identifying User-Agent their policy asks for. */
async function fromNominatim(params, env) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams(params)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': env.NOMINATIM_UA ?? 'TripAI/1.0 (+https://travel-ai-6de47.web.app)',
        },
      }
    )
    if (!res.ok) return null

    return (await res.json()).map((h) => ({
      lat: +h.lat,
      lng: +h.lon,
      label: h.display_name,
      name: h.name || h.display_name.split(',')[0],
      city: h.address?.city ?? h.address?.town ?? h.address?.village ?? h.address?.municipality ?? '',
      country: h.address?.country ?? '',
      type: h.addresstype ?? h.type ?? '',
      // Contact details, when OSM has them. Absent far more often than
      // present, so the UI has to treat every one of these as optional.
      phone: h.extratags?.phone ?? h.extratags?.['contact:phone'] ?? null,
      website: h.extratags?.website ?? h.extratags?.['contact:website'] ?? null,
      hours: h.extratags?.opening_hours ?? null,
      reservation: h.extratags?.['reservation'] ?? null,
    }))
  } catch {
    return null
  }
}
