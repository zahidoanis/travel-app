import { useEffect, useMemo, useState } from 'react'

/**
 * /admin — daily usage, for the person running the site. Behind a password
 * (the worker's STATS_TOKEN), kept in this browser after the first sign-in.
 * Rendered outside TripProvider on purpose: opening it doesn't create an
 * anonymous account or count as a visit.
 *
 * Hebrew only — it's an operator's page, not part of the product.
 */
// i18n-ignore-start — admin-only page, not translated

const PROXY = (import.meta.env?.VITE_AI_PROXY_URL ?? '').replace(/\/$/, '')
const KEY = 'tripai.admin'

/** AI request kinds, as the app labels them (gemini.js callers). */
const KINDS = [
  ['chat', 'צ\'אט'],
  ['opener', 'פתיחת צ\'אט'],
  ['plan', 'בניית ימים'],
  ['food', 'מסעדות'],
  ['import', 'ייבוא מפה'],
  ['suggest', 'הצעות עצירות'],
  ['hotels', 'מלונות'],
  ['arrival', 'הגעה'],
  ['lookup', 'איתור מקום'],
  ['other', 'אחר'],
]
const KIND_IDS = new Set(KINDS.map(([id]) => id))

const shortDate = (iso) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}.${m}`
}

/** Every day from `from` to `today`, inclusive. */
function dayRange(from, today) {
  const out = []
  const d = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${today}T12:00:00Z`)
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

function rowsFrom(data) {
  const byDay = {}
  for (const day of dayRange(data.from, data.today)) byDay[day] = { day, m: {}, visitors: 0, aiUsers: 0 }
  for (const { day, metric, n } of data.metrics) if (byDay[day]) byDay[day].m[metric] = n
  for (const { day, kind, n } of data.unique) {
    if (!byDay[day]) continue
    if (kind === 'app') byDay[day].visitors = n
    if (kind === 'ai') byDay[day].aiUsers = n
  }
  return Object.values(byDay).map((r) => {
    const ai = Object.entries(r.m).filter(([k]) => k.startsWith('ai.') && KIND_IDS.has(k.slice(3))).reduce((a, [, n]) => a + n, 0)
    return {
      day: r.day,
      visitors: r.visitors,
      opens: r.m['app.open'] ?? 0,
      trips: (r.m['app.trip'] ?? 0) + (r.m['app.import'] ?? 0),
      imports: r.m['app.import'] ?? 0,
      joins: r.m['app.join'] ?? 0,
      ai,
      aiUsers: r.aiUsers,
      kinds: Object.fromEntries(KINDS.map(([id]) => [id, r.m[`ai.${id}`] ?? 0])),
      maps: r.m['ai.maps'] ?? 0,
      quotaHits: r.m['ai.429'] ?? 0,
      fallback: r.m['ai.workersai'] ?? 0,
      failed: r.m['ai.fail'] ?? 0,
      geo: r.m.geo ?? 0,
    }
  })
}

/**
 * One measure per chart — never two scales on one axis. Bars in a single
 * gold that clears 3:1 against the card; a dashed reference line is on the
 * same scale as the bars. Hover (or tap) a bar for its exact value.
 */
function BarChart({ rows, field, title, reference, referenceLabel }) {
  const [hover, setHover] = useState(null)
  const W = 640
  const H = 170
  const pad = { top: 16, right: 8, bottom: 22, left: 34 }
  const values = rows.map((r) => r[field])
  const max = Math.max(1, ...values, reference ?? 0)
  const nice = (() => {
    const step = 10 ** Math.floor(Math.log10(max))
    return Math.ceil(max / step) * step
  })()
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const slot = plotW / rows.length
  const barW = Math.max(3, Math.min(22, slot - 2)) // a 2px gap between bars at least
  const y = (v) => pad.top + plotH - (v / nice) * plotH
  const ticks = [0, nice / 2, nice]
  const labelEvery = Math.ceil(rows.length / 8)
  const h = hover != null ? rows[hover] : null

  return (
    <figure className="admin-chart">
      <figcaption>
        <span>{title}</span>
        {h && (
          <span className="admin-chart-readout">
            {shortDate(h.day)}: <strong className="num">{h[field].toLocaleString()}</strong>
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, ${rows.length} ימים`} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} className="admin-grid" />
            <text x={pad.left - 6} y={y(v) + 4} className="admin-axis" textAnchor="end">{v.toLocaleString()}</text>
          </g>
        ))}
        {reference != null && (
          <g>
            <line x1={pad.left} x2={W - pad.right} y1={y(reference)} y2={y(reference)} className="admin-ref" />
            <text x={W - pad.right} y={y(reference) - 5} className="admin-axis" textAnchor="end">{referenceLabel}</text>
          </g>
        )}
        {rows.map((r, i) => {
          const v = r[field]
          const x = pad.left + i * slot + (slot - barW) / 2
          const top = y(v)
          return (
            <g key={r.day}>
              {/* The hit target is the whole column, wider than the bar. */}
              <rect
                x={pad.left + i * slot} y={pad.top} width={slot} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              />
              {v > 0 && (() => {
                // Rounded at the top only, flat on the baseline; at least 3px
                // tall so a value of 1 still reads as a bar.
                const h = Math.max(3, y(0) - top)
                const r = Math.min(4, barW / 2, h)
                return (
                  <g className={`admin-bar ${hover === i ? 'on' : ''}`} pointerEvents="none">
                    <rect x={x} y={y(0) - h} width={barW} height={h} rx={r} />
                    <rect x={x} y={y(0) - r} width={barW} height={r} />
                  </g>
                )
              })()}
              {i % labelEvery === 0 && (
                <text x={pad.left + i * slot + slot / 2} y={H - 6} className="admin-axis" textAnchor="middle">{shortDate(r.day)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export default function Admin() {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(KEY) ?? '' } catch { return '' }
  })
  const [input, setInput] = useState('')
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [state, setState] = useState(token ? 'loading' : 'login') // login | loading | ready | error
  const [error, setError] = useState(null)

  useEffect(() => {
    document.title = 'TripAI — ניהול'
  }, [])

  useEffect(() => {
    if (!token) return
    let live = true
    setState('loading')
    fetch(`${PROXY}/stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!live) return
        if (res.status === 401) {
          try { localStorage.removeItem(KEY) } catch { /* ignore */ }
          setToken('')
          setError('הסיסמה לא נכונה.')
          setState('login')
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setData(await res.json())
        setState('ready')
      })
      .catch((e) => {
        if (!live) return
        setError(`לא הצלחתי לטעון את הנתונים (${e.message}).`)
        setState('error')
      })
    return () => { live = false }
  }, [token, days])

  const rows = useMemo(() => (data ? rowsFrom(data) : []), [data])
  const today = rows.at(-1)
  const ceiling = data ? data.keys * data.models * data.perKeyModel : 0
  const pct = today && ceiling ? Math.round((today.ai / ceiling) * 100) : 0
  const status = pct >= 85 ? 'critical' : pct >= 60 ? 'warning' : 'good'
  const statusText = { good: 'תקין', warning: 'מתקרב לתקרה', critical: 'קרוב לתקרה' }[status]

  const signIn = (e) => {
    e.preventDefault()
    const v = input.trim()
    if (!v) return
    try { localStorage.setItem(KEY, v) } catch { /* ignore */ }
    setError(null)
    setToken(v)
  }

  const signOut = () => {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    setToken('')
    setData(null)
    setState('login')
  }

  return (
    <div className="admin" dir="rtl" lang="he">
      <header className="admin-head">
        <div>
          <h1 className="h1" style={{ fontSize: 24 }}>TripAI · ניהול</h1>
          <p className="tiny" style={{ margin: '4px 0 0' }}>שימוש יומי באתר ובסוכן ה-AI</p>
        </div>
        {token && (
          <div className="row" style={{ gap: 8 }}>
            <select className="field admin-range" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="טווח ימים">
              <option value={7}>7 ימים</option>
              <option value={30}>30 ימים</option>
              <option value={90}>90 ימים</option>
            </select>
            <button className="btn btn-ghost btn-sm" onClick={signOut}>יציאה</button>
          </div>
        )}
      </header>

      {state === 'login' && (
        <form className="card admin-login" onSubmit={signIn}>
          <strong>כניסה לעמוד הניהול</strong>
          <p className="tiny" style={{ margin: '6px 0 14px' }}>הסיסמה נשמרת בדפדפן הזה, כך שצריך להקליד אותה רק פעם אחת.</p>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="סיסמה"
            aria-label="סיסמה"
            dir="ltr"
            autoFocus
          />
          {error && <p className="tiny" style={{ color: 'var(--rose)', margin: '10px 0 0' }}>{error}</p>}
          <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} type="submit">כניסה</button>
        </form>
      )}

      {state === 'loading' && <p className="tiny" style={{ padding: 20 }}>טוען…</p>}
      {state === 'error' && <p className="tiny" style={{ padding: 20, color: 'var(--rose)' }}>{error}</p>}

      {state === 'ready' && today && (
        <>
          {/* Today's headline numbers — tiles, not a chart. */}
          <section className="admin-tiles" aria-label="היום">
            <div className="card admin-tile">
              <span className="tiny">מבקרים היום</span>
              <strong className="num">{today.visitors.toLocaleString()}</strong>
              <span className="tiny">{today.opens.toLocaleString()} כניסות</span>
            </div>
            <div className="card admin-tile">
              <span className="tiny">טיולים חדשים היום</span>
              <strong className="num">{today.trips.toLocaleString()}</strong>
              <span className="tiny">{today.imports > 0 ? `${today.imports} מ-Google Maps` : ' '}</span>
            </div>
            <div className="card admin-tile">
              <span className="tiny">בקשות AI היום</span>
              <strong className="num">{today.ai.toLocaleString()}</strong>
              <span className="tiny">{today.aiUsers.toLocaleString()} משתמשים שונים</span>
            </div>
            <div className={`card admin-tile status-${status}`}>
              <span className="tiny">מכסת AI היום</span>
              <strong className="num">{pct}%</strong>
              <span className="admin-status">
                <span aria-hidden="true">{status === 'good' ? '●' : status === 'warning' ? '▲' : '■'}</span>
                {statusText} · מתוך כ-{ceiling.toLocaleString()}
              </span>
            </div>
          </section>

          {(today.quotaHits > 0 || today.fallback > 0 || today.failed > 0) && (
            <p className="tiny admin-note">
              היום: {today.quotaHits} פגיעות במכסה (המערכת עברה למפתח או מודל אחר)
              {today.fallback > 0 && ` · ${today.fallback} תשובות מהמודל החלופי של Cloudflare`}
              {today.failed > 0 && ` · ${today.failed} בקשות נכשלו`}
            </p>
          )}

          <section className="admin-charts">
            <BarChart rows={rows} field="visitors" title="מבקרים ייחודיים ביום" />
            <BarChart rows={rows} field="trips" title="טיולים חדשים ביום" />
            <BarChart rows={rows} field="ai" title="בקשות AI ביום" reference={ceiling} referenceLabel={`תקרה ~${ceiling.toLocaleString()}`} />
          </section>

          {/* Today's AI by kind — magnitude across categories, one hue, labelled. */}
          <section className="card admin-kinds">
            <strong>בקשות AI היום, לפי סוג</strong>
            {today.ai === 0 ? (
              <p className="tiny" style={{ margin: '8px 0 0' }}>עוד אין בקשות היום.</p>
            ) : (
              <ul>
                {KINDS.filter(([id]) => today.kinds[id] > 0)
                  .sort((a, b) => today.kinds[b[0]] - today.kinds[a[0]])
                  .map(([id, label]) => (
                    <li key={id}>
                      <span className="admin-kind-label">{label}</span>
                      <span className="admin-kind-bar"><i style={{ width: `${(today.kinds[id] / today.ai) * 100}%` }} /></span>
                      <span className="num admin-kind-n">{today.kinds[id]}</span>
                    </li>
                  ))}
              </ul>
            )}
            {today.maps > 0 && <p className="tiny" style={{ margin: '10px 0 0' }}>{today.maps} מהן עם נתוני Google Maps (דירוגי מסעדות).</p>}
          </section>

          {/* The same numbers as a table — for reading exact values. */}
          <section className="card admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>תאריך</th><th>מבקרים</th><th>כניסות</th><th>טיולים</th><th>בקשות AI</th>
                  <th>צ'אט</th><th>בניית ימים</th><th>מסעדות</th><th>פגיעות במכסה</th><th>נכשלו</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.day}>
                    <td>{shortDate(r.day)}</td>
                    <td className="num">{r.visitors}</td>
                    <td className="num">{r.opens}</td>
                    <td className="num">{r.trips}</td>
                    <td className="num"><strong>{r.ai}</strong></td>
                    <td className="num">{r.kinds.chat + r.kinds.opener}</td>
                    <td className="num">{r.kinds.plan}</td>
                    <td className="num">{r.kinds.food}</td>
                    <td className="num">{r.quotaHits}</td>
                    <td className="num">{r.failed + r.fallback}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <p className="tiny admin-foot">
            הספירה התחילה ב-3.10.2026. "מבקר" הוא דפדפן (מזהה אקראי שנשמר בו), לא אדם — טלפון ומחשב של אותו אדם נספרים פעמיים.
            התקרה היא הערכה: {data.keys} מפתחות × {data.models} מודלים × {data.perKeyModel} בקשות חינמיות ביום. השעון לפי שעון ישראל.
          </p>
        </>
      )}
    </div>
  )
}
// i18n-ignore-end
