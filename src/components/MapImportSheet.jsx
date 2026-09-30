import { useState } from 'react'
import Sheet from './Sheet'
import { Link, Bed, Calendar, MapPin, Check, AlertTriangle } from './Icons'
import { fetchGoogleMap, planFromMap } from '../lib/mapImport'
import { breadcrumb } from '../lib/telemetry'
import { t, tn, lang } from '../i18n'

const fmt = (iso) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}` : '')

/**
 * Paste a Google Maps link, see what it holds, bring it in. Nothing is
 * saved here — `onImport` hands the plan back to onboarding, which fills
 * in destination, dates and hotel, and creates the days with the trip.
 */
export default function MapImportSheet({ open, onClose, onImport }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)

  const load = async () => {
    if (!link.trim() || busy) return
    setBusy(true)
    setError(null)
    setPlan(null)
    breadcrumb('action', 'google maps import: load')
    try {
      setPlan(planFromMap(await fetchGoogleMap(link), lang))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const stops = plan?.days.reduce((n, d) => n + d.places.length, 0) ?? 0

  return (
    <Sheet open={open} onClose={onClose} title={t('ייבוא מ-Google Maps')}>
      <p className="sub" style={{ marginTop: -6, marginBottom: 14 }}>
        {t('הדבק קישור שיתוף של מפה מ-My Maps או של מסלול ניווט. שכבה במפה הופכת ליום בטיול.')}
      </p>

      <div className="row field-row">
        <Link size={17} />
        <input
          className="field-bare"
          dir="ltr"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="https://www.google.com/maps/d/…"
          aria-label={t('קישור ל-Google Maps')}
          autoFocus
        />
      </div>
      <button className="btn btn-ghost btn-block" style={{ marginTop: 10 }} onClick={load} disabled={!link.trim() || busy}>
        {busy ? <span className="typing"><i /><i /><i /></span> : t('טען מפה')}
      </button>

      {error && (
        <p className="alert-card row" style={{ marginTop: 14, padding: 12, gap: 8, alignItems: 'flex-start', borderRadius: 14, fontSize: 13 }}>
          <AlertTriangle size={16} /> <span>{error}</span>
        </p>
      )}

      {plan && (
        <div style={{ marginTop: 18 }}>
          <strong style={{ fontSize: 16 }}>{plan.title || plan.destination}</strong>
          <div className="tiny row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
            {plan.destination && <span className="row" style={{ gap: 4 }}><MapPin size={13} />{plan.destination}{plan.country ? `, ${plan.country}` : ''}</span>}
            {plan.from && <span className="row" style={{ gap: 4 }}><Calendar size={13} /><span className="num" dir="ltr">{fmt(plan.from)}–{fmt(plan.to)}</span></span>}
            {plan.hotel && <span className="row" style={{ gap: 4 }}><Bed size={13} />{plan.hotel.name}</span>}
          </div>

          <ol style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: 8 }}>
            {plan.days.map((d, i) => (
              <li key={i} className="card" style={{ padding: '10px 12px' }}>
                <div className="between">
                  <strong style={{ fontSize: 14 }}>
                    {t('יום {n}', { n: i + 1 })}
                    {d.date && <span className="tiny num" style={{ marginInlineStart: 6 }}>{fmt(d.date)}</span>}
                  </strong>
                  <span className="tiny"><span className="num">{d.places.length}</span> {tn(d.places.length, 'עצירה', 'עצירות')}</span>
                </div>
                <p className="tiny" style={{ margin: '4px 0 0', lineHeight: 1.5 }}>
                  {d.places.map((p) => p.name.split(',')[0]).join(' · ')}
                </p>
              </li>
            ))}
          </ol>

          <p className="tiny" style={{ marginTop: 12 }}>
            {t('הסוכן יוסיף שעות ותיאורים, בלי לשנות את המקומות או את הסדר שלך.')}
          </p>
          <button
            className="btn btn-primary btn-block"
            style={{ marginTop: 12 }}
            onClick={() => {
              breadcrumb('action', `google maps import: ${plan.days.length} days, ${stops} stops`)
              onImport(plan)
            }}
          >
            <Check size={17} /> {t('ייבא {n} ימים', { n: plan.days.length })}
          </button>
        </div>
      )}
    </Sheet>
  )
}
