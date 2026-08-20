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
const DEFAULT_MODEL = 'gemini-2.5-flash'

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
        maxOutputTokens: 800,
        ...(body.generationConfig ?? {}),
      },
    }

    if (forwarded.contents.length === 0) {
      return json({ error: { message: 'No contents supplied' } }, 400, cors)
    }

    const upstream = await fetch(
      `${API}/models/${model}:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`,
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
