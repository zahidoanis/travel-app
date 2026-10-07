import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import { Images, Plus, Pencil, Trash, Share, X } from '../components/Icons'
import { useTrip } from '../TripProvider'
import { dateForDay } from './Days'
import { trackKm } from '../lib/track'
import {
  listEntries, saveEntry, deleteEntry, getPhoto, shrinkPhoto, newId,
} from '../lib/journal'
import { breadcrumb, record } from '../lib/telemetry'
import { t, tn } from '../i18n'

/** A stored photo, shown from its blob; the object URL is released on unmount. */
function Photo({ id, onClick, className = '' }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let live = true
    let made = null
    getPhoto(id).then((blob) => {
      if (!live || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [id])
  if (!url) return <span className={`journal-photo skeleton ${className}`} />
  return (
    <button className={`journal-photo ${className}`} onClick={onClick} aria-label={t('הגדל תמונה')}>
      <img src={url} alt="" loading="lazy" />
    </button>
  )
}

/**
 * The trip journal: notes and photos, by day, kept on this phone only (see
 * lib/journal.js). A photo or a line about a stop, a share button for the
 * entry, and a summary of the trip so far.
 */
export default function Journal() {
  const { trip, days, activeDay, trackPoints } = useTrip()
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(null)       // null | { entry?, day, stopName, note, keep[], added[] }
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [viewing, setViewing] = useState(null) // photo id
  const [viewUrl, setViewUrl] = useState(null)
  const fileRef = useRef(null)
  const [shareNote, setShareNote] = useState(null)

  const reload = () => listEntries(trip.id).then((rows) => { setEntries(rows); setLoaded(true) }).catch(() => setLoaded(true))
  useEffect(() => { if (trip) { setLoaded(false); reload() } }, [trip?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewing) { setViewUrl(null); return }
    let live = true
    let made = null
    getPhoto(viewing).then((b) => { if (live && b) { made = URL.createObjectURL(b); setViewUrl(made) } })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [viewing])

  // Previews of photos picked in the form, released when they change.
  const previews = useMemo(() => (form?.added ?? []).map((a) => ({ ...a, url: URL.createObjectURL(a.blob) })), [form?.added])
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews])

  if (!trip) return null

  const byDay = {}
  for (const e of entries) (byDay[e.day] ??= []).push(e)
  const photoCount = entries.reduce((n, e) => n + (e.photoIds?.length ?? 0), 0)
  const plannedStops = Object.values(days).reduce((n, list) => n + list.length, 0)
  const km = trackKm(trackPoints)

  const open = (entry) => setForm(entry
    ? { entry, day: entry.day, stopName: entry.stopName ?? '', note: entry.note ?? '', keep: [...(entry.photoIds ?? [])], added: [] }
    : { day: Math.min(activeDay, trip.totalDays), stopName: '', note: '', keep: [], added: [] })

  const pick = async (files) => {
    setError(null)
    try {
      const shrunk = await Promise.all([...files].map(async (f) => ({ id: newId(), blob: await shrinkPhoto(f) })))
      setForm((f) => ({ ...f, added: [...f.added, ...shrunk] }))
    } catch {
      setError(t('לא הצלחתי לקרוא את התמונה. נסו תמונה אחרת.'))
    }
  }

  const save = async () => {
    if (!form || saving) return
    if (!form.note.trim() && form.keep.length + form.added.length === 0) {
      setError(t('כתבו משהו או הוסיפו תמונה.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const entry = {
        id: form.entry?.id ?? newId(),
        tripId: trip.id,
        day: form.day,
        stopName: form.stopName || null,
        note: form.note.trim(),
        photoIds: [...form.keep, ...form.added.map((a) => a.id)],
        at: form.entry?.at ?? Date.now(),
      }
      const removed = (form.entry?.photoIds ?? []).filter((id) => !form.keep.includes(id))
      await saveEntry(entry, form.added, removed)
      breadcrumb('action', `journal: saved entry (${entry.photoIds.length} photos)`)
      setForm(null)
      await reload()
    } catch {
      setError(t('השמירה נכשלה. ייתכן שאין מקום פנוי במכשיר.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entry) => {
    if (!window.confirm(t('למחוק את הרשומה הזו מהיומן? אי אפשר לשחזר.'))) return
    await deleteEntry(entry)
    await reload()
  }

  const fileOf = async (id) => {
    const blob = await getPhoto(id)
    return blob ? new File([blob], `tripai-${id.slice(0, 6)}.jpg`, { type: 'image/jpeg' }) : null
  }

  /**
   * Shares photos through the phone's share sheet. Apps differ in what they
   * accept — some drop a file when a caption comes with it, some take one
   * file only — so it tries the richest form first and steps down. When it
   * can't send photos at all it says so: it used to fall back to the caption
   * alone in silence, and the person on the other end got a message with no
   * photos in it.
   *
   * @returns {Promise<boolean>} whether something was handed to the share sheet
   */
  const sharePhotos = async (files, text) => {
    const attempts = [
      { files, text },
      { files },
      ...(files.length > 1 ? files.map((f) => ({ files: [f] })).slice(0, 1) : []),
    ]
    for (const data of attempts) {
      if (!navigator.canShare?.(data)) continue
      try {
        await navigator.share(data)
        return true
      } catch (err) {
        if (err?.name === 'AbortError') return true // the person closed the sheet
        record({ kind: 'share', level: 'warn', message: `share failed: ${err?.name}: ${err?.message}` })
      }
    }
    return false
  }

  const share = async (entry) => {
    setShareNote(null)
    const text = [
      `${trip.city} · ${t('יום {n}', { n: entry.day })}${entry.stopName ? ` · ${entry.stopName}` : ''}`,
      entry.note,
    ].filter(Boolean).join('\n')
    try {
      const files = (await Promise.all((entry.photoIds ?? []).map(fileOf))).filter(Boolean)
      if (files.length > 0) {
        if (!(await sharePhotos(files, text))) {
          setShareNote(t('הטלפון או האפליקציה לא קיבלו את התמונות. פתחו תמונה ושמרו אותה למכשיר, או שלחו אותה אחת-אחת.'))
        }
        return
      }
      if (navigator.share) await navigator.share({ text })
      else await navigator.clipboard?.writeText(text)
    } catch (err) {
      if (err?.name !== 'AbortError') setShareNote(t('השיתוף נכשל.'))
    }
  }

  /** One photo, on its own — the form every share target accepts. */
  const shareOne = async (id) => {
    setShareNote(null)
    const f = await fileOf(id)
    if (f && !(await sharePhotos([f], ''))) setShareNote(t('השיתוף נכשל. אפשר לשמור את התמונה למכשיר.'))
  }

  const saveOne = async (id) => {
    const blob = await getPhoto(id)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tripai-${id.slice(0, 6)}.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const shareSummary = async () => {
    const lines = [
      t('הטיול שלי ב{city} 🗺️', { city: trip.city }),
      `${t('{n} ימים', { n: trip.totalDays })} · ${tn(plannedStops, 'מקום אחד', '{n} מקומות', { n: plannedStops })}${km > 0.1 ? ` · ${km.toFixed(1)} ${t('ק"מ ברגל')}` : ''}${photoCount > 0 ? ` · ${tn(photoCount, 'תמונה אחת', '{n} תמונות', { n: photoCount })}` : ''}`,
    ]
    try {
      if (navigator.share) await navigator.share({ text: lines.join('\n') })
      else await navigator.clipboard?.writeText(lines.join('\n'))
    } catch { /* cancelled */ }
  }

  const dayStops = days[form?.day] ?? []

  return (
    <div className="screen">
      <TopBar />

      <div className="pad">
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 className="h1" style={{ fontSize: 24 }}>{t('יומן הטיול')}</h1>
            <p className="tiny" style={{ marginTop: 4 }}>{t('תמונות והערות מהדרך. נשמר רק במכשיר הזה.')}</p>
          </div>
          {entries.length > 0 && (
            <button className="icon-btn boxed" onClick={() => open(null)} aria-label={t('רשומה חדשה')} title={t('רשומה חדשה')}>
              <Plus size={18} />
            </button>
          )}
        </div>

        {shareNote && !viewing && (
          <p className="alert-card tiny" style={{ marginTop: 14, padding: 12, borderRadius: 14 }} role="alert">{shareNote}</p>
        )}

        {entries.length > 0 && (
          <div className="card journal-summary">
            <div className="journal-stats">
              <span><strong className="num">{trip.totalDays}</strong> {tn(trip.totalDays, 'יום', 'ימים')}</span>
              <span><strong className="num">{plannedStops}</strong> {tn(plannedStops, 'מקום', 'מקומות')}</span>
              <span><strong className="num">{km > 0.1 ? km.toFixed(1) : '—'}</strong> {t('ק"מ ברגל')}</span>
              <span><strong className="num">{photoCount}</strong> {tn(photoCount, 'צילום', 'תמונות')}</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={shareSummary}>
              <Share size={14} /> {t('שתפו סיכום')}
            </button>
          </div>
        )}

        {loaded && entries.length === 0 && (
          <div className="card empty-state" style={{ marginTop: 20 }}>
            <span className="empty-icon"><Images size={22} /></span>
            <strong style={{ fontSize: 15 }}>{t('היומן ריק')}</strong>
            <p className="tiny" style={{ margin: '6px 0 16px', maxWidth: '34ch' }}>
              {t('צלמו, כתבו שורה על המקום, ובסוף הטיול יהיה לכם סיפור. הכול נשמר רק בטלפון הזה.')}
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => open(null)}>
              <Plus size={15} /> {t('הרשומה הראשונה')}
            </button>
          </div>
        )}

        {Object.keys(byDay).map(Number).sort((a, b) => a - b).map((day) => (
          <section key={day} style={{ marginTop: 22 }}>
            <h2 className="h2" style={{ fontSize: 15, marginBottom: 10 }}>
              {t('יום {n}', { n: day })}
              {dateForDay(trip, day) && <span className="tiny" style={{ marginInlineStart: 8, fontWeight: 500 }}>{dateForDay(trip, day)}</span>}
            </h2>
            <div className="col" style={{ gap: 10 }}>
              {byDay[day].map((e) => (
                <article key={e.id} className="card journal-entry">
                  {e.stopName && <span className="badge" style={{ marginBottom: 8 }}>{e.stopName}</span>}
                  {e.photoIds?.length > 0 && (
                    <div className={`journal-photos n${Math.min(e.photoIds.length, 4)}`}>
                      {e.photoIds.map((id) => <Photo key={id} id={id} onClick={() => setViewing(id)} />)}
                    </div>
                  )}
                  {e.note && <p className="journal-note">{e.note}</p>}
                  <div className="row journal-actions">
                    <span className="tiny grow num">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button className="icon-btn" onClick={() => share(e)} aria-label={t('שתף')}><Share size={16} /></button>
                    <button className="icon-btn" onClick={() => open(e)} aria-label={t('ערוך')}><Pencil size={16} /></button>
                    <button className="icon-btn" onClick={() => remove(e)} aria-label={t('מחק')}><Trash size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Sheet open={Boolean(form)} title={form?.entry ? t('עריכת רשומה') : t('רשומה חדשה')} onClose={() => !saving && setForm(null)}>
        {form && (
          <>
            <div className="row" style={{ gap: 10 }}>
              <label className="grow">
                <span className="label">{t('יום')}</span>
                <select className="field" value={form.day} onChange={(e) => setForm({ ...form, day: Number(e.target.value), stopName: '' })}>
                  {Array.from({ length: trip.totalDays }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>{t('יום {n}', { n: d })}</option>
                  ))}
                </select>
              </label>
              <label className="grow">
                <span className="label">{t('עצירה (לא חובה)')}</span>
                <select className="field" value={form.stopName} onChange={(e) => setForm({ ...form, stopName: e.target.value })}>
                  <option value="">{t('ללא')}</option>
                  {dayStops.map((s) => <option key={s.id} value={s.he ?? s.name}>{s.he ?? s.name}</option>)}
                </select>
              </label>
            </div>

            <span className="label" style={{ marginTop: 14 }}>{t('מה היה שם?')}</span>
            <textarea
              className="field"
              rows={3}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder={t('שורה על המקום, הטעם, ההרגשה…')}
              aria-label={t('הערה')}
            />

            <div className="journal-picked">
              {form.keep.map((id) => (
                <span key={id} className="journal-picked-item">
                  <Photo id={id} />
                  <button className="journal-x" onClick={() => setForm({ ...form, keep: form.keep.filter((x) => x !== id) })} aria-label={t('הסר תמונה')}><X size={13} /></button>
                </span>
              ))}
              {previews.map((p) => (
                <span key={p.id} className="journal-picked-item">
                  <span className="journal-photo"><img src={p.url} alt="" /></span>
                  <button className="journal-x" onClick={() => setForm({ ...form, added: form.added.filter((x) => x.id !== p.id) })} aria-label={t('הסר תמונה')}><X size={13} /></button>
                </span>
              ))}
              <button className="journal-add" onClick={() => fileRef.current?.click()} type="button">
                <Images size={20} />
                <span>{t('הוסף תמונות')}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => { pick(e.target.files); e.target.value = '' }}
              />
            </div>

            {error && <p className="tiny" style={{ color: 'var(--rose)', margin: '10px 0 0' }}>{error}</p>}

            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={save} disabled={saving}>
              {saving ? <span className="typing"><i /><i /><i /></span> : t('שמור ביומן')}
            </button>
          </>
        )}
      </Sheet>

      <Sheet open={Boolean(viewing)} title={t('תמונה')} onClose={() => setViewing(null)}>
        {viewUrl && <img className="journal-big" src={viewUrl} alt="" />}
        {viewing && (
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary grow" onClick={() => shareOne(viewing)}><Share size={16} /> {t('שתף תמונה')}</button>
            <button className="btn btn-ghost grow" onClick={() => saveOne(viewing)}>{t('שמור במכשיר')}</button>
          </div>
        )}
        {shareNote && <p className="tiny" style={{ color: 'var(--rose)', margin: '10px 0 0' }}>{shareNote}</p>}
      </Sheet>
    </div>
  )
}
