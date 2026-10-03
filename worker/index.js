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
 *
 * Optional — extra Gemini keys, each from a SEPARATE Google project (the
 * quota is per project, so same-project keys add nothing): GEMINI_API_KEY_2
 * … GEMINI_API_KEY_8. Any subset can be set; a request tries a random one
 * first per model and falls through the rest only on a 429.
 *   wrangler secret put GEMINI_API_KEY_2
 *
 * Optional — live web search for questions that need current info (a price,
 * whether something is open now), via Tavily's free tier (1,000 searches/mo
 * PER ACCOUNT, no card): wrangler secret put TAVILY_API_KEY
 * Gemini has no browsing tool of its own — without this it correctly (and
 * only) says so. With it, a heuristic match on the user's last message
 * fetches real results first and folds them into this same request as
 * context, rather than a second model call. Extra Tavily accounts each add
 * their own 1,000/month, same idea as the Gemini keys: TAVILY_API_KEY_2 … _5.
 *
 * Optional — real bookable attractions/tours for "what is there to do"
 * questions, via Viator's Affiliate API (Basic Access: free, self-serve, no
 * approval wait): wrangler secret put VIATOR_API_KEY
 * Same idea as the Tavily block, but a dedicated booking API beats a web
 * search here — a real product, price, rating and booking link instead of
 * an article that merely mentions one.
 */

const API = 'https://generativelanguage.googleapis.com/v1beta'
// gemini-2.5-flash still appears in the models listing but returns 404 for
// new API keys; Google's own error points here instead.
const DEFAULT_MODEL = 'gemini-3.6-flash'

// Other free-tier models that answered on 2026-09-19, tried in this order
// once the requested model's daily quota is spent. Each has its own quota.
const FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]

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

    // Google Maps import. The browser can't read Google's KML export itself
    // (no CORS), so this fetches it and hands back plain JSON.
    if (request.method === 'GET' && url.pathname === '/mymap') {
      const result = await importGoogleMap(url.searchParams.get('url') ?? '')
      return json(result.body, result.status, {
        ...cors,
        'Cache-Control': result.status === 200 ? 'public, max-age=300' : 'no-store',
      })
    }

    // Liveness probe. Reveals nothing secret — only how many keys are
    // present — so deployment can be verified without spending Gemini quota.
    if (request.method === 'GET') {
      return json(
        {
          ok: true,
          service: 'tripai-ai',
          model: DEFAULT_MODEL,
          keysConfigured: geminiKeys(env).length,
          tavilyKeysConfigured: tavilyKeys(env).length,
          viatorConfigured: Boolean(env.VIATOR_API_KEY),
          allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean).length,
        },
        200,
        cors
      )
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors })
    }
    // GEMINI_API_KEY_2 / _3 are optional extra free-tier keys — each Google
    // account can mint its own, so this is how the effective request ceiling
    // gets multiplied without ever needing a paid one.
    const keys = geminiKeys(env)
    if (keys.length === 0) {
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

    // Grounding with Google Maps: the model reads real Maps data (ratings,
    // review counts, the place's Maps link) for this one request. Opt-in per
    // request — only the restaurant list asks — and the only tool this proxy
    // will ever attach; free-tier keys can't be billed for it, a spent quota
    // just fails the request.
    const grounded = body.grounding === 'maps'
    const latLng =
      grounded && Number.isFinite(body.latLng?.latitude) && Number.isFinite(body.latLng?.longitude)
        ? { latitude: body.latLng.latitude, longitude: body.latLng.longitude }
        : null

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
      ...(grounded
        ? {
            tools: [{ googleMaps: {} }],
            ...(latLng ? { toolConfig: { retrievalConfig: { latLng } } } : {}),
          }
        : {}),
    }

    if (forwarded.contents.length === 0) {
      return json({ error: { message: 'No contents supplied' } }, 400, cors)
    }

    // A question that genuinely needs live info ("what's the price tonight",
    // "is it open now") used to get an honest "I can't browse the internet" —
    // correct, since the model has no such tool, but not useful. A cheap
    // keyword match on the last thing the user actually typed decides
    // whether to spend one Tavily call getting real results first, folded
    // into this same request as extra context — not a second Gemini call,
    // which would double the very quota this file exists to stretch.
    const lastUserText = [...forwarded.contents].reverse().find((c) => c.role === 'user')
      ?.parts?.map((p) => p.text ?? '').join(' ') ?? ''
    if (tavilyKeys(env).length > 0 && NEEDS_SEARCH.test(lastUserText)) {
      // The trigger word only needs to be in the last message, but a
      // follow-up like "check their website" names no "their" on its own —
      // the last few turns give the search query the actual subject (the
      // hotel/place named a turn or two earlier) instead of a bare pronoun.
      const recentContext = forwarded.contents
        .slice(-4)
        .map((c) => (c.parts ?? []).map((p) => p.text ?? '').join(' '))
        .filter(Boolean)
        .join(' | ')
      const found = await tavilySearch(env, recentContext || lastUserText, body.searchContext)
      if (found) {
        forwarded.systemInstruction = {
          parts: [
            ...(forwarded.systemInstruction?.parts ?? []),
            {
              text:
                'תוצאות חיפוש אינטרנט חיות (Tavily), רלוונטיות לשאלה האחרונה של המשתמש:\n' +
                found +
                '\n\nיש לך עכשיו גישה למידע הזה — אל תגיד שאין לך גישה לאינטרנט. ' +
                'ענה על סמך התוצאות, וציין בקצרה שזה מבוסס על חיפוש עדכני. ' +
                'אם התוצאות לא עונות על השאלה, אמור זאת בכנות במקום לנחש.',
            },
          ],
        }
      }
    }

    // Same idea as the Tavily block above, but for "what's there to do" —
    // Viator's Basic Access affiliate API (free, self-serve) instead of a
    // generic web search: real bookable tours/attractions, real prices, real
    // ratings, and a real productUrl that already carries the account's own
    // affiliate id (pid), so a click-through is attributed automatically.
    if (env.VIATOR_API_KEY && NEEDS_ATTRACTIONS.test(lastUserText)) {
      const found = await viatorSearch(env, lastUserText, body.searchContext)
      if (found) {
        forwarded.systemInstruction = {
          parts: [
            ...(forwarded.systemInstruction?.parts ?? []),
            {
              text:
                'תוצאות אמיתיות מ-Viator (אטרקציות/סיורים אמיתיים שאפשר להזמין), רלוונטיות לשאלה האחרונה:\n' +
                found +
                '\n\nיש לך עכשיו גישה למידע הזה — אלה מקומות אמיתיים עם מחיר ודירוג אמיתיים, לא הצעות כלליות. ' +
                'כשאתה מציע אחד מהם, כלול את הקישור (productUrl) בדיוק כפי שהוא, בלי לשנות אותו — זה קישור הזמנה אמיתי. ' +
                'אם אף תוצאה לא רלוונטית לשאלה (למשל שאלו על מסעדות), פשוט התעלם מהן וענה כרגיל — ' +
                'ובשום מקרה אל תמציא סיור או מחיר שלא מופיעים כאן.',
            },
          ],
        }
      }
    }

    // The free quota is 20 requests per DAY, per project, per MODEL
    // (GenerateRequestsPerDayPerProjectPerModel-FreeTier) — so adding keys
    // only helps if they're in separate projects, while every *model* has its
    // own independent 20. Try the requested model across all keys first, then
    // fall through the other models still on the free tier. Retried on 429
    // (quota), 503 (model overloaded) and 404 (model retired); any other
    // HTTP failure — a bad request — would fail the same way everywhere, so
    // it is returned straight away.
    const RETRY = grounded ? new Set([429, 503, 404, 400]) : new Set([429, 503, 404])
    const models = [model, ...FALLBACK_MODELS.filter((m) => m !== model)]
    const start = Math.floor(Math.random() * keys.length)
    let goodText = null // a validated, usable SSE response body, once found
    let lastBadUpstream = null
    let calls = 0
    outer: for (const m of models) {
      for (let i = 0; i < keys.length; i++) {
        const idx = (start + i) % keys.length
        const key = keys[idx]
        const tag = idx + '|' + m
        if ((spent.get(tag) ?? 0) > Date.now()) continue
        if (++calls > 40) break outer
        const upstream = await fetch(
          // Trim and encode: piping a secret in from a shell easily leaves a
          // trailing newline, which produces an opaque "API key not valid"
          // from Google rather than anything pointing at the real cause.
          `${API}/models/${m}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key.trim())}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(forwarded),
          }
        )

        if (upstream.status === 429) { spent.set(tag, Date.now() + SPENT_MS); continue }
        if (RETRY.has(upstream.status)) { lastBadUpstream = upstream; break } // next model
        if (!upstream.ok) { lastBadUpstream = upstream; break outer } // a real bad request

        // HTTP 200 — but Gemini 3.x occasionally tries to call an internal
        // tool that was never declared here (a trained bias toward
        // well-known agentic tool names, seen even with zero tools
        // registered on this request) and ends the turn with
        // MALFORMED_FUNCTION_CALL and no usable text — which still reports
        // 200, so none of the status checks above ever catch it. Buffered
        // rather than streamed straight through so this can be caught
        // before an empty reply ever reaches the client — the chat already
        // buffers the whole reply client-side before showing anything, so
        // nothing is lost by buffering here too.
        const raw = await upstream.text()
        if (hasUsableText(raw)) { goodText = raw; break outer }
        // 200 but nothing usable — try the next key/model instead.
      }
    }

    if (goodText) {
      return new Response(goodText, {
        headers: {
          ...cors,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Every Gemini model and key was either out of quota/down, or kept
    // coming back with no usable text: last resort is Cloudflare's own
    // Workers AI on this same account — free daily allowance, no extra key.
    // Weaker Hebrew than Gemini, hence last.
    const fallback = grounded ? null : await viaWorkersAI(env, forwarded)
    if (fallback) {
      return new Response(fallback, {
        headers: {
          ...cors,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    if (lastBadUpstream) {
      const text = await lastBadUpstream.text()
      return new Response(text, {
        status: lastBadUpstream.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Every combination was spent, or a valid-looking 200 with nothing
    // usable in it, and Workers AI had nothing either.
    return json({ error: { code: 502, message: 'no usable reply from any key, model, or fallback' } }, 502, cors)
  },
}

/** GEMINI_API_KEY, then GEMINI_API_KEY_2 … _8 — whichever are set. */
const geminiKeys = (env) =>
  ['', '_2', '_3', '_4', '_5', '_6', '_7', '_8'].map((n) => env['GEMINI_API_KEY' + n]).filter(Boolean)

// key+model combos that just answered 429, remembered per isolate (best
// effort — a cold isolate simply forgets). Skipping them keeps a request
// under Workers' ~50 outbound-call limit now that there are 8 keys x 6
// models, and stops it re-asking a quota that is known to be spent.
const spent = new Map()
const SPENT_MS = 30 * 60 * 1000

const CF_MODELS = ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/mistralai/mistral-small-3.1-24b-instruct']

// Hebrew and English phrasing for "needs an answer that only exists right
// now, out on the live web" — a price, hours, whether something is open,
// availability, a rating, being asked to actually go look something up.
// Imprecise on purpose: a missed match just gets the honest "no live
// access" answer as before, a wrong match spends one harmless Tavily call.
const NEEDS_SEARCH = new RegExp(
  [
    'מחיר', 'עולה', 'עלות', 'זול', 'יקר',
    'שעות פתיחה', 'פתוח', 'סגור', 'זמין', 'זמינות',
    'עכשיו', 'היום', 'כרגע', 'עדכני',
    'תבדוק', 'תחפש', 'חפש', 'תסתכל', 'באתר', 'קישור', 'לינק',
    'דירוג', 'ביקורות', 'חוות דעת',
    'price', 'cost', 'open now', 'is it open', 'available', 'website', 'link',
    'rating', 'review', 'search', 'look up', 'check (the|if)',
  ].join('|'),
  'i'
)

/** TAVILY_API_KEY, then TAVILY_API_KEY_2 … _5 — whichever are set. Each is
 *  its own free account (1,000 searches/month each), so more keys is a real
 *  multiplier here, the same way it is for Gemini. */
const tavilyKeys = (env) =>
  ['', '_2', '_3', '_4', '_5'].map((n) => env['TAVILY_API_KEY' + n]).filter(Boolean)

/**
 * One Tavily call, condensed to a short block of plain text the model can
 * read as context — never returned raw to the client. Tries each configured
 * key in turn: 432/433 is that key's monthly credits spent, 401 is a bad
 * key, either way the next one gets a turn. Any other failure (network,
 * Tavily itself down) stops trying rather than burning through every key on
 * an error that would repeat.
 */
async function tavilySearch(env, userText, extraContext) {
  const keys = tavilyKeys(env)
  const query = `${userText.slice(-400)}${extraContext ? ` (${extraContext})` : ''}`

  for (const key of keys) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: key,
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true,
        }),
      })
      if (!res.ok) {
        if ([401, 432, 433].includes(res.status)) continue
        return null
      }
      const data = await res.json()

      const lines = []
      if (data.answer) lines.push(`תקציר: ${data.answer}`)
      for (const r of data.results ?? []) {
        if (!r.title && !r.content) continue
        lines.push(`- ${r.title ?? ''}: ${(r.content ?? '').slice(0, 300)} (${r.url ?? ''})`)
      }
      return lines.length > 0 ? lines.join('\n') : null
    } catch {
      // Offline or Tavily itself unreachable — another key would fail the
      // same way. The request still goes through to Gemini, just without
      // live context.
      return null
    }
  }
  return null
}

// Hebrew and English phrasing for "what is there to do/see/book here" — the
// one case where a dedicated, free, real booking API (Viator) beats a
// generic Tavily web search: it returns an actual bookable product with a
// real price and a real link, not an article that merely mentions one.
// Same imprecise-on-purpose trade as NEEDS_SEARCH.
//
// Stems, not whole phrases: the first version listed exact phrases ("מה
// כדאי לעשות") and missed most real ones — "מה לראות", "מה מומלץ", "המלצות
// למחר", "איפה כדאי לבקר", and every English phrasing — so the feature looked
// like it had stopped working when it had simply never fired. Erring wide is
// cheap here: Viator's free tier allows 150 requests per 10 seconds, and the
// injected instruction below tells the model to ignore results that don't fit.
const NEEDS_ATTRACTIONS = new RegExp(
  [
    'אטרקצי', 'סיור', 'טיול מאורגן', 'טיול יום', 'כרטיס', 'פעילו',
    'לעשות', 'לראות', 'לבקר', 'ביקור', 'לבלות', 'בילוי',
    'מומלץ', 'המלצ', 'תמליץ', 'ממליץ', 'רעיונ', 'שווה', 'מקומות', 'שייט', 'סדנ',
    'attraction', 'tour', 'things to', 'to do', 'to see', 'visit', 'sightseeing',
    'activit', 'ticket', 'excursion', 'recommend', 'ideas?', 'day trip', 'cruise', 'should we do', 'can we do',
  ].join('|'),
  'i'
)

/**
 * One call to Viator's `/search/freetext` (Basic Access — free, self-serve,
 * verified 2026-09-29 against the live API rather than guessed from docs:
 * base `https://api.viator.com/partner`, auth via the `exp-api-key` header,
 * `Accept: application/json;version=2.0`). Condensed to the same
 * short-plain-text-block shape tavilySearch returns, so it slots into the
 * system instruction the same way.
 */
async function viatorSearch(env, userText, cityContext) {
  const key = env.VIATOR_API_KEY
  if (!key) return null

  const searchTerm = `${userText.slice(-200)}${cityContext ? ` in ${cityContext}` : ''}`.trim()
  if (!searchTerm) return null

  try {
    const res = await fetch('https://api.viator.com/partner/search/freetext', {
      method: 'POST',
      headers: {
        Accept: 'application/json;version=2.0',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json',
        'exp-api-key': key,
      },
      body: JSON.stringify({
        searchTerm,
        currency: 'USD',
        searchTypes: [{ searchType: 'PRODUCTS', pagination: { start: 1, count: 5 } }],
      }),
    })
    if (!res.ok) return null

    const results = (await res.json())?.products?.results ?? []
    const lines = results
      .filter((p) => p.title && p.productUrl)
      .map((p) => {
        const price = p.pricing?.summary?.fromPrice
        const rating = p.reviews?.combinedAverageRating
        const reviewCount = p.reviews?.totalReviews
        const bits = [
          price != null ? `החל מ-$${price}` : null,
          rating ? `דירוג ${rating.toFixed(1)}${reviewCount ? ` (${reviewCount} ביקורות)` : ''}` : null,
        ].filter(Boolean).join(' · ')
        return `- ${p.title}${bits ? `: ${bits}` : ''} — ${p.productUrl}`
      })
    return lines.length > 0 ? lines.join('\n') : null
  } catch {
    // Offline or Viator itself unreachable — the request still goes through
    // to Gemini, just without this context.
    return null
  }
}

/**
 * Runs the same request on Workers AI and re-frames its stream as Gemini's
 * SSE shape, so the app's existing parser needs to know nothing about it.
 * Returns a ReadableStream, or null when the binding is missing / every
 * model errors (out of the daily free allowance included).
 */
async function viaWorkersAI(env, forwarded) {
  if (!env.AI) return null

  const messages = []
  const system = (forwarded.systemInstruction?.parts ?? []).map((p) => p.text ?? '').join('\n')
  if (system) messages.push({ role: 'system', content: system })
  for (const c of forwarded.contents) {
    messages.push({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: (c.parts ?? []).map((p) => p.text ?? '').join(''),
    })
  }

  for (const model of CF_MODELS) {
    try {
      const stream = await env.AI.run(model, {
        messages,
        stream: true,
        max_tokens: forwarded.generationConfig?.maxOutputTokens ?? 2048,
        temperature: forwarded.generationConfig?.temperature ?? 0.7,
      })
      return stream.pipeThrough(toGeminiFrames())
    } catch {
      /* out of allowance or model unavailable — try the next one */
    }
  }
  return null
}

/** Workers AI `data: {"response":"tok"}` frames -> Gemini `candidates` frames. */
function toGeminiFrames() {
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  let buffer = ''
  const frame = (text, done) =>
    enc.encode(
      `data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0, ...(done ? { finishReason: 'STOP' } : {}) }],
      })}\n\n`
    )
  return new TransformStream({
    transform(chunk, controller) {
      buffer += dec.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const t = JSON.parse(payload).response
          if (typeof t === 'string' && t) controller.enqueue(frame(t, false))
        } catch { /* partial frame */ }
      }
    },
    flush(controller) {
      controller.enqueue(frame('', true))
    },
  })
}

/** Whether a Gemini SSE body actually contains any answer text — the check
 *  that catches MALFORMED_FUNCTION_CALL and any other finish reason that
 *  leaves nothing to show, all of which still arrive as HTTP 200. */
function hasUsableText(sse) {
  for (const block of sse.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    try {
      const j = JSON.parse(line.slice(5))
      for (const p of j.candidates?.[0]?.content?.parts ?? []) {
        if (typeof p.text === 'string' && p.text.trim()) return true
      }
    } catch {
      /* a partial or malformed chunk — not itself proof of a bad reply */
    }
  }
  return false
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

/* ---------- Google Maps import ---------- */

// Only ever fetches Google — this must never become an open proxy.
const GOOGLE_HOST = /(^|\.)google\.[a-z.]{2,6}$|^maps\.app\.goo\.gl$|^goo\.gl$/i

/**
 * A pasted Google Maps link -> { kind, title, layers: [{ name, places }] }.
 *
 * Two shapes are readable without an API key:
 *   - My Maps (`/maps/d/...?mid=`, or the same map opened inside Google Maps,
 *     `...!6m1!1s<mid>`): Google serves a public map as KML, with its layers,
 *     place names, descriptions and exact coordinates. Verified on a real
 *     5-layer Lisbon trip.
 *   - Directions (`/maps/dir/A/B/C`): the stops are in the path, and their
 *     coordinates, in order, in the `data=` blob.
 * Saved lists have no public export at all, so they get a clear "unsupported".
 */
async function importGoogleMap(raw) {
  let link
  try {
    link = new URL(raw.trim())
  } catch {
    return { status: 400, body: { error: 'bad-url' } }
  }
  if (!GOOGLE_HOST.test(link.hostname)) return { status: 400, body: { error: 'not-google' } }

  // Short links (maps.app.goo.gl/...) are redirects to the full URL. Followed
  // by hand so every hop can be checked against GOOGLE_HOST.
  for (let hop = 0; hop < 5 && /goo\.gl$/i.test(link.hostname); hop++) {
    const res = await fetch(link.toString(), { redirect: 'manual' })
    const next = res.headers.get('Location')
    if (!next) break
    link = new URL(next, link)
    if (!GOOGLE_HOST.test(link.hostname)) return { status: 400, body: { error: 'not-google' } }
  }

  const full = decodeURIComponent(link.toString())
  const mid = link.searchParams.get('mid') ?? full.match(/!6m1!1s([\w-]{20,})/)?.[1]
  if (mid) return myMap(mid)

  const dir = link.pathname.match(/\/maps\/dir\/(.+)$/)?.[1]
  if (dir) return directions(dir, full)

  return { status: 422, body: { error: 'unsupported' } }
}

async function myMap(mid) {
  const res = await fetch(`https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`)
  const text = await res.text()
  // A private or deleted map answers with an HTML error page, not KML.
  if (!res.ok || !text.includes('<kml')) return { status: 404, body: { error: 'private-or-missing' } }

  const doc = text.match(/<Document>([\s\S]*)<\/Document>/)?.[1] ?? text
  const folders = [...doc.matchAll(/<Folder>([\s\S]*?)<\/Folder>/g)].map((m) => m[1])
  const layers = (folders.length ? folders : [doc])
    .map((f) => ({ name: kmlText(f.match(/<name>([\s\S]*?)<\/name>/)?.[1]), places: placemarks(f) }))
    .filter((l) => l.places.length > 0)

  if (layers.length === 0) return { status: 422, body: { error: 'empty' } }
  const title = kmlText(doc.replace(/<Folder>[\s\S]*<\/Folder>/g, '').match(/<name>([\s\S]*?)<\/name>/)?.[1])
  return { status: 200, body: { kind: 'mymap', title, layers } }
}

/** Point placemarks only — a layer's drawn route line is geometry, not a stop. */
function placemarks(xml) {
  return [...xml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)]
    .map((m) => m[1])
    .filter((p) => p.includes('<Point>'))
    .map((p) => {
      const [lng, lat] = (p.match(/<coordinates>\s*([^<]+)<\/coordinates>/)?.[1] ?? '').trim().split(',').map(Number)
      return {
        name: kmlText(p.match(/<name>([\s\S]*?)<\/name>/)?.[1]),
        desc: kmlText(p.match(/<description>([\s\S]*?)<\/description>/)?.[1]).slice(0, 300),
        lat, lng,
      }
    })
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))
}

/** Unwraps CDATA, drops the HTML Google puts in descriptions, decodes entities. */
function kmlText(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function directions(path, full) {
  const names = path
    .split('/')
    .filter((seg) => seg && !seg.startsWith('@') && !seg.startsWith('data='))
    .map((seg) => decodeURIComponent(seg.replace(/\+/g, ' ')).trim())
    .filter(Boolean)
  // Each waypoint's coordinates, in order: "!2m2!1d<lng>!2d<lat>".
  const coords = [...full.matchAll(/!2m2!1d(-?[\d.]+)!2d(-?[\d.]+)/g)].map((m) => ({ lng: Number(m[1]), lat: Number(m[2]) }))
  const exact = coords.length === names.length
  const places = names.map((name, i) => ({ name, desc: '', ...(exact ? coords[i] : { lat: null, lng: null }) }))
  if (places.length === 0) return { status: 422, body: { error: 'empty' } }
  return { status: 200, body: { kind: 'directions', title: '', layers: [{ name: '', places }] } }
}
