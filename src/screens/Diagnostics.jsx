import { useEffect, useState } from 'react'
import {
  AlertTriangle, Check, Copy, RefreshCw, X, Info, Bot,
} from '../components/Icons'
import {
  getEntries, subscribe, clearEntries, exportText, diagnosticsSummary,
} from '../lib/telemetry'
import { hasFirebase } from '../lib/firebase'
import { copyText } from '../lib/share'

const KIND_LABEL = {
  exception: 'חריגה',
  rejection: 'Promise שנדחה',
  render: 'קריסת רינדור',
  network: 'רשת',
  slow: 'איטיות',
  freeze: 'תקיעה',
  hang: 'פעולה תקועה',
  console: 'console',
  resource: 'משאב',
  db: 'מסד נתונים',
}

const LEVEL_COLOR = { error: 'var(--rose)', warn: 'var(--amber)', info: 'var(--cyan)' }

const time = (ms) =>
  new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function Diagnostics({ onClose }) {
  const [entries, setEntries] = useState(getEntries)
  const [open, setOpen] = useState(null)
  const [copied, setCopied] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => subscribe(() => setEntries(getEntries())), [])

  const summary = diagnosticsSummary()
  const shown = filter === 'all' ? entries : entries.filter((e) => e.level === filter)

  const copyAll = async () => {
    if (await copyText(exportText())) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ color: 'var(--lav)' }}><AlertTriangle size={18} /></span>
          <h1 className="h2">יומן אבחון</h1>
        </div>
        <button className="icon-btn boxed" onClick={onClose} aria-label="סגור">
          <X size={17} />
        </button>
      </header>

      <div className="pad">
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="diag-stats">
            <Stat value={summary.total} label="סה״כ" />
            <Stat value={summary.errors} label="שגיאות" color="var(--rose)" />
            <Stat value={summary.warnings} label="אזהרות" color="var(--amber)" />
            <Stat value={summary.unsent} label="לא נשלחו" />
          </div>
          <p className="tiny" style={{ marginTop: 12, marginBottom: 0 }}>
            {hasFirebase
              ? 'רשומות נשמרות מקומית ומשוכפלות ל-Firestore.'
              : 'Firebase לא מוגדר — הרשומות נשמרות מקומית בלבד ושורדות רענון.'}
          </p>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <button className="btn btn-ghost btn-sm grow" onClick={copyAll}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'הועתק' : 'העתק הכל'}
          </button>
          <button
            className="btn btn-ghost btn-sm grow"
            onClick={() => { clearEntries(); setOpen(null) }}
          >
            <RefreshCw size={15} />
            נקה
          </button>
        </div>

        <div className="pills" style={{ marginBottom: 16 }}>
          {[
            ['all', 'הכל'],
            ['error', 'שגיאות'],
            ['warn', 'אזהרות'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={`pill ${filter === id ? 'on' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {shown.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 30 }}>
            <span style={{ color: 'var(--emerald)' }}><Check size={26} /></span>
            <p className="sub" style={{ marginTop: 10 }}>לא נרשמו תקלות. הכול תקין.</p>
          </div>
        )}

        <div className="col" style={{ gap: 9 }}>
          {shown.map((e) => {
            const expanded = open === e.id
            return (
              <div key={e.id} className="card diag-entry">
                <button
                  className="diag-head"
                  onClick={() => setOpen(expanded ? null : e.id)}
                  aria-expanded={expanded}
                >
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <i className="dot" style={{ background: LEVEL_COLOR[e.level] ?? 'var(--muted)' }} />
                    <span className="badge" style={{ padding: '2px 8px', fontSize: 10 }}>
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    {e.count > 1 && <span className="tiny">×{e.count}</span>}
                  </span>
                  <span className="tiny num">{time(e.at)}</span>
                </button>

                <p className="diag-msg">{e.message}</p>

                {expanded && (
                  <div className="diag-detail">
                    {e.context && (
                      <>
                        <span className="label">הקשר</span>
                        <pre className="diag-pre">{JSON.stringify(e.context, null, 2)}</pre>
                      </>
                    )}

                    {e.breadcrumbs?.length > 0 && (
                      <>
                        <span className="label">מה קרה לפני</span>
                        <ol className="diag-crumbs">
                          {e.breadcrumbs.slice(-8).map((b, i) => (
                            <li key={i}>
                              <span className="tiny num">{time(b.at)}</span>
                              <span>{b.type}: {b.label}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}

                    {e.stack && (
                      <>
                        <span className="label">Stack</span>
                        <pre className="diag-pre">{e.stack}</pre>
                      </>
                    )}

                    <span className="tiny">
                      session {e.session} · {Math.round(e.uptime / 1000)}s מתחילת הריצה
                      {e.sent ? ' · נשלח' : ' · ממתין לשליחה'}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="card" style={{ marginTop: 18, background: 'transparent' }}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 9 }}>
            <span style={{ color: 'var(--muted)' }}><Info size={15} /></span>
            <p className="tiny" style={{ margin: 0 }}>
              המסך נפתח עם <code>?debug=1</code> בכתובת, או בלחיצה ארוכה על מספר
              הגרסה. נתפסות חריגות, Promise שנדחו, קריסות רינדור, כשלי רשת,
              תקיעות של הממשק ופעולות שלא הסתיימו.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ value, label, color }) {
  return (
    <div className="col" style={{ alignItems: 'center', gap: 2 }}>
      <strong className="num" style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--text)' }}>
        {value}
      </strong>
      <span className="tiny">{label}</span>
    </div>
  )
}
