import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import MapCanvas from './MapCanvas'
import { Plus, Check, Navigation, AlertTriangle } from './Icons'
import { useTrip } from '../TripProvider'
import { geocode, search } from '../lib/geocode'
import { navigateUrl } from '../lib/staticMap'
import { normaliseCategory } from '../lib/itinerary'
import { breadcrumb } from '../lib/telemetry'
import { t } from '../i18n'

const CANDIDATE = 'candidate'

/** Lowercase, no accents, no punctuation — "Pastéis de Belém" ≈ "pasteis de belem". */
const norm = (s = '') =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim()

/**
 * Same place by name? Word overlap measured against the LONGER name, so
 * "Castelo de São Jorge" ≈ "São Jorge Castle" (2 of 3) but "Prado" is not
 * "Jardim Eduardo Prado Coelho" (1 of 4) — both real cases.
 */
function sameName(a, b) {
  const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2))
  const A = words(a)
  const B = words(b)
  if (A.size === 0 || B.size === 0) return false
  const shared = [...A].filter((w) => B.has(w)).length
  return shared / Math.max(A.size, B.size) >= 0.5
}

/** An hour and a half after the day's last stop, or noon on an empty day. */
function nextFreeTime(list) {
  const last = [...list].map((s) => s.time).filter((x) => /^\d{1,2}:\d{2}$/.test(x ?? '')).sort().at(-1)
  if (!last) return '12:00'
  const [h, m] = last.split(':').map(Number)
  const mins = Math.min(22 * 60, h * 60 + m + 90)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

/**
 * A place the agent mentioned, opened from its link in the chat: where it is
 * on the map next to the chosen day's stops, and one tap to add it to that
 * day. The agent gives two names — what to show, and an English
 * "Place, City, Country" string that geocodes reliably.
 */
export default function PlaceSheet({ place, onClose }) {
  const { trip, days, activeDay, addStop } = useTrip()
  const [hit, setHit] = useState(null)
  const [status, setStatus] = useState('loading') // loading | found | missing
  const [day, setDay] = useState(activeDay)
  const [time, setTime] = useState('12:00')
  const [added, setAdded] = useState(null)
  const [unsure, setUnsure] = useState(false)

  useEffect(() => {
    if (!place) return
    let live = true
    setStatus('loading')
    setHit(null)
    setAdded(null)
    setDay(activeDay)
    ;(async () => {
      // Top result alone isn't trusted: a restaurant called "Prado" came back
      // as "Jardim Eduardo Prado Coelho", a park across town. Prefer a
      // candidate that actually carries the place's name, near the trip.
      const want = place.query.split(',')[0]
      const near = (h) => trip?.lat == null || Math.abs(h.lat - trip.lat) + Math.abs(h.lng - trip.lng) < 1
      const hits = (await search(place.query, 3)).filter(near)
      const named = hits.find((h) => sameName(h.name, want))
      const found = named ?? hits[0] ?? (await geocode(place.label, trip?.cityEn ?? trip?.city))
      if (!live) return
      setHit(found)
      setUnsure(Boolean(found) && !named)
      setStatus(found ? 'found' : 'missing')
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place])

  const dayStops = (days[day] ?? []).filter((s) => s.lat != null && s.lng != null)
  useEffect(() => { setTime(nextFreeTime(days[day] ?? [])) }, [day, days])

  if (!place) return null

  const already = (days[day] ?? []).some((s) => s.he === place.label || (hit && s.name === hit.name))
  const candidate = hit && {
    id: CANDIDATE,
    name: place.label,
    he: place.label,
    time,
    cat: normaliseCategory(place.label + ' ' + (hit.name ?? '')),
    lat: hit.lat,
    lng: hit.lng,
  }

  const add = () => {
    if (!hit || already) return
    breadcrumb('action', `chat place added to day ${day}`)
    addStop(day, {
      name: (hit.name || place.query.split(',')[0]).trim(),
      he: place.label,
      desc: '',
      time,
      cat: candidate.cat,
      rating: null,
      lat: hit.lat,
      lng: hit.lng,
    })
    setAdded(day)
  }

  const total = trip?.totalDays ?? 1

  return (
    <Sheet open onClose={onClose} title={place.label}>
      <div className="place-map">
        {status === 'found' ? (
          <MapCanvas stops={[...dayStops, candidate]} activeId={CANDIDATE} hotels={[]} />
        ) : (
          <div className="place-map-msg">
            {status === 'loading'
              ? <span className="typing"><i /><i /><i /></span>
              : <><AlertTriangle size={16} /> {t('לא הצלחתי לאתר את המקום על המפה')}</>}
          </div>
        )}
      </div>
      <p className="tiny" style={{ margin: '8px 2px 0' }} dir="auto">{hit?.label ?? place.query}</p>
      {unsure && (
        <p className="tiny row" style={{ margin: '6px 2px 0', gap: 6, color: 'var(--amber)' }}>
          <AlertTriangle size={13} />
          {t('ייתכן שזה לא המקום המדויק — כדאי לבדוק את הכתובת לפני שמוסיפים.')}
        </p>
      )}

      <span className="label" style={{ marginTop: 16 }}>{t('להוסיף ליום')}</span>
      <div className="place-days" role="radiogroup" aria-label={t('בחר יום')}>
        {Array.from({ length: total }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            role="radio"
            aria-checked={d === day}
            className={`pill ${d === day ? 'on' : ''}`}
            onClick={() => { setDay(d); setAdded(null) }}
          >
            {t('יום {n}', { n: d })}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 10, marginTop: 14, alignItems: 'center' }}>
        <label className="tiny" htmlFor="place-time">{t('שעה')}</label>
        <input
          id="place-time"
          type="time"
          className="field"
          style={{ width: 120 }}
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <span className="tiny grow">
          {t('{n} עצירות ביום הזה', { n: (days[day] ?? []).length })}
        </span>
      </div>

      <div className="row" style={{ gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary grow" onClick={add} disabled={status !== 'found' || already || added === day}>
          {added === day || already
            ? <><Check size={17} /> {t('נמצא ביום {n}', { n: day })}</>
            : <><Plus size={17} /> {t('הוסף ליום {n}', { n: day })}</>}
        </button>
        {hit && (
          <a
            className="btn btn-ghost"
            href={navigateUrl(hit.lat, hit.lng, place.label)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('פתח ב-Google Maps')}
          >
            <Navigation size={17} />
          </a>
        )}
      </div>
    </Sheet>
  )
}
