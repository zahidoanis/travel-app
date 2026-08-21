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
      const kind = url.searchParams.get('kind')
      if (kind === 'city') params.featuretype = 'settlement'

      const upstream = await fetch(
        `https://nominatim.openstreetmap.org/search?${new URLSearchParams(params)}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': env.NOMINATIM_UA ?? 'TripAI/1.0 (+https://travel-ai-6de47.web.app)',
          },
        }
      )

      if (!upstream.ok) {
        return json({ error: { message: `nominatim ${upstream.status}` } }, 502, cors)
      }

      const hits = await upstream.json()

      return json(
        hits.map((h) => ({
          lat: +h.lat,
          lng: +h.lon,
          label: h.display_name,
          name: h.name || h.display_name.split(',')[0],
          city:
            h.address?.city ?? h.address?.town ?? h.address?.village ?? h.address?.municipality ?? '',
          country: h.address?.country ?? '',
          type: h.addresstype ?? h.type ?? '',
        })),
        200,
        // The same place resolves to the same point — let the edge remember it.
        { ...cors, 'Cache-Control': 'public, max-age=86400' }
      )
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
