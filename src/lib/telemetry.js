/**
 * Crash and error capture.
 *
 * Design rule that drives everything here: **the logger must never be the
 * reason something breaks.** So it writes to localStorage first — which works
 * offline, survives a reload, and needs no configuration — and only then tries
 * to mirror to Firestore. Every entry point is wrapped in try/catch and fails
 * silently. If telemetry is broken you lose logs, never the app.
 *
 * What it catches:
 *   - uncaught exceptions            (window 'error')
 *   - rejected promises              (window 'unhandledrejection')
 *   - React render crashes           (ErrorBoundary calls record())
 *   - failed network requests        (patched fetch)
 *   - console.error calls
 *   - main-thread freezes            (rAF heartbeat)
 *   - async operations that hang     (watchdog())
 *
 * Each entry carries the last 20 breadcrumbs, so you see what the user did
 * right before it broke rather than a bare stack trace.
 */

const STORAGE_KEY = 'tripai.diag.v1'
const MAX_ENTRIES = 200
const MAX_BREADCRUMBS = 20
const FREEZE_MS = 3000 // a frame gap longer than this counts as a freeze
const MAX_FLUSH_PER_SESSION = 60

const sessionId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const startedAt = Date.now()

let breadcrumbs = []
let entries = []
let installed = false
let flushed = 0
let sink = null // set by attachSink() once Firestore is ready

/* ------------------------------------------------------------------ *
 * storage
 * ------------------------------------------------------------------ */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    entries = raw ? JSON.parse(raw) : []
  } catch {
    entries = []
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // Quota exceeded, private mode, whatever — keep the in-memory copy.
  }
}

/* ------------------------------------------------------------------ *
 * recording
 * ------------------------------------------------------------------ */

/** Collapses repeats of the same problem into one entry with a count. */
function fingerprint(entry) {
  const head = (entry.stack ?? '').split('\n').slice(0, 2).join('|')
  return `${entry.kind}:${entry.message}:${head}`.slice(0, 300)
}

export function record(input) {
  try {
    const entry = {
      id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      kind: input.kind ?? 'error',
      level: input.level ?? 'error',
      message: String(input.message ?? 'Unknown error').slice(0, 500),
      stack: input.stack ? String(input.stack).slice(0, 4000) : null,
      context: input.context ?? null,
      breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS),
      session: sessionId,
      uptime: Date.now() - startedAt,
      url: typeof location !== 'undefined' ? location.pathname + location.search : null,
      count: 1,
      sent: false,
    }

    const fp = fingerprint(entry)
    const existing = entries.find((e) => e.fp === fp && !e.sent)

    if (existing) {
      // Same failure again — bump the counter instead of flooding the log.
      existing.count += 1
      existing.at = entry.at
    } else {
      entries.push({ ...entry, fp })
      if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES)
    }

    persist()
    scheduleFlush()
  } catch {
    /* never throw from the recorder */
  }
}

export function breadcrumb(type, label, data) {
  try {
    breadcrumbs.push({
      at: Date.now(),
      type,
      label: String(label).slice(0, 120),
      ...(data ? { data } : {}),
    })
    if (breadcrumbs.length > MAX_BREADCRUMBS * 2) {
      breadcrumbs = breadcrumbs.slice(-MAX_BREADCRUMBS)
    }
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * remote mirroring
 * ------------------------------------------------------------------ */

/** Firestore (or anything else) plugs in here. `fn(entries) => Promise`. */
export function attachSink(fn) {
  sink = fn
  scheduleFlush()
}

let flushTimer = null

function scheduleFlush() {
  if (!sink || flushTimer) return
  // Batch, so a burst of 30 identical errors is one write, not thirty.
  flushTimer = setTimeout(flush, 4000)
}

async function flush() {
  flushTimer = null
  if (!sink) return

  const pending = entries.filter((e) => !e.sent).slice(0, 20)
  if (pending.length === 0) return
  if (flushed >= MAX_FLUSH_PER_SESSION) return

  try {
    await sink(pending.map(({ fp, sent, ...rest }) => rest))
    flushed += pending.length
    for (const e of pending) e.sent = true
    persist()
  } catch {
    // Offline or rules rejected the write — entries stay unsent and are
    // retried on the next error. Never surface this to the user.
  }
}

/* ------------------------------------------------------------------ *
 * watchdog — for async work that can hang without ever throwing
 * ------------------------------------------------------------------ */

/**
 * Flags an operation that starts but never finishes.
 *
 *   const done = watchdog('gemini.reply', 20000)
 *   try { await ... } finally { done() }
 */
export function watchdog(name, ms = 15000, context) {
  const started = Date.now()
  const timer = setTimeout(() => {
    record({
      kind: 'hang',
      level: 'warn',
      message: `הפעולה "${name}" לא הסתיימה תוך ${ms}ms`,
      context: { ...context, operation: name, timeoutMs: ms },
    })
  }, ms)

  return () => {
    clearTimeout(timer)
    const took = Date.now() - started
    if (took > ms * 0.6) {
      breadcrumb('slow', `${name} took ${took}ms`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * install
 * ------------------------------------------------------------------ */

export function initTelemetry() {
  if (installed || typeof window === 'undefined') return
  installed = true
  load()

  window.addEventListener('error', (event) => {
    // Failed <img>/<script> loads arrive here too, without an Error object.
    if (event.target && event.target !== window && event.target.tagName) {
      record({
        kind: 'resource',
        level: 'warn',
        message: `נכשלה טעינת ${event.target.tagName.toLowerCase()}`,
        context: { src: event.target.src ?? event.target.href ?? null },
      })
      return
    }
    record({
      kind: 'exception',
      message: event.message,
      stack: event.error?.stack,
      context: { file: event.filename, line: event.lineno, col: event.colno },
    })
  }, true)

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    record({
      kind: 'rejection',
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
    })
  })

  // console.error — catches library warnings and React's own complaints.
  const originalError = console.error
  console.error = (...args) => {
    try {
      const text = args
        .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a)))
        .join(' ')
      const err = args.find((a) => a instanceof Error)
      record({ kind: 'console', level: 'warn', message: text, stack: err?.stack })
    } catch {
      /* ignore */
    }
    originalError.apply(console, args)
  }

  patchFetch()
  watchForFreezes()

  breadcrumb('lifecycle', 'app started')
}

function safeJson(value) {
  try {
    return JSON.stringify(value)?.slice(0, 200) ?? String(value)
  } catch {
    return '[unserialisable]'
  }
}

/** Records network failures and slow requests without changing fetch semantics. */
function patchFetch() {
  const original = window.fetch
  if (!original || original.__tripaiPatched) return

  const patched = async (input, init) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '')
    const started = performance.now()

    // Never log our own telemetry writes — that would loop.
    const internal = url.includes('firestore.googleapis.com')

    try {
      const res = await original(input, init)
      const took = Math.round(performance.now() - started)

      if (!internal && !res.ok) {
        record({
          kind: 'network',
          level: res.status >= 500 ? 'error' : 'warn',
          message: `${res.status} ${res.statusText || ''} — ${shortUrl(url)}`,
          context: { url: shortUrl(url), status: res.status, ms: took },
        })
      } else if (!internal && took > 8000) {
        record({
          kind: 'slow',
          level: 'warn',
          message: `בקשה איטית (${took}ms) — ${shortUrl(url)}`,
          context: { url: shortUrl(url), ms: took },
        })
      }
      return res
    } catch (err) {
      if (!internal && err?.name !== 'AbortError') {
        record({
          kind: 'network',
          message: `הבקשה נכשלה — ${shortUrl(url)}`,
          stack: err?.stack,
          context: { url: shortUrl(url), error: err?.message },
        })
      }
      throw err
    }
  }

  patched.__tripaiPatched = true
  window.fetch = patched
}

/** Strips query strings so API keys never land in the log. */
function shortUrl(url) {
  try {
    const u = new URL(url, location.href)
    return `${u.origin}${u.pathname}`
  } catch {
    return String(url).split('?')[0]
  }
}

/**
 * Detects main-thread freezes. Frames should arrive every ~16ms; a gap of
 * several seconds means something blocked the thread — an infinite loop, a
 * huge synchronous parse, a runaway render.
 */
function watchForFreezes() {
  let last = performance.now()

  const tick = () => {
    const now = performance.now()
    const gap = now - last
    last = now

    // Ignore gaps caused by the tab being backgrounded.
    if (gap > FREEZE_MS && document.visibilityState === 'visible') {
      record({
        kind: 'freeze',
        level: 'warn',
        message: `הממשק נתקע ל-${Math.round(gap)}ms`,
        context: { gapMs: Math.round(gap) },
      })
    }
    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)

  document.addEventListener('visibilitychange', () => {
    last = performance.now() // don't count background time as a freeze
    breadcrumb('lifecycle', `visibility: ${document.visibilityState}`)
  })
}
