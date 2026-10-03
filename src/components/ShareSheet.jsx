import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { WhatsApp, Check, Users, Link as LinkIcon } from './Icons'
import { headCount } from '../data'
import { useTrip } from '../TripProvider'
import { useConfirm } from './Confirm'
import { inviteTokens, resetInviteTokens } from '../lib/db'
import { hasFirebase } from '../lib/firebase'
import { inviteText, inviteUrl, shareTrip, copyText } from '../lib/share'
import { t, tn } from '../i18n'

export default function ShareSheet({ open, stops, onClose }) {
  const { trip: TRIP, families: FAMILIES, canEdit } = useTrip()
  // The links' tokens live apart from the trip (see secrets/ in
  // firebase.rules) and are read when the sheet opens: a viewer can read
  // only the view-only one.
  const [tokens, setTokens] = useState({ edit: null, view: null })
  useEffect(() => {
    if (!open || !TRIP?.id || !hasFirebase) return
    let live = true
    inviteTokens(TRIP.id).then((found) => { if (live) setTokens(found) })
    return () => { live = false }
  }, [open, TRIP?.id])
  // What the people this link reaches may do. A viewer can only pass on
  // the view-only link.
  const [viewOnly, setViewOnly] = useState(!canEdit)
  const confirm = useConfirm()
  const [resetDone, setResetDone] = useState(false)
  const [copied, setCopied] = useState(null)

  if (!TRIP) return null

  const text = inviteText(TRIP, stops, TRIP.id)
  // Trips made before view-only links have no tokens yet; the first editor
  // to ask for a view-only link creates both.
  const chooseViewOnly = async (next) => {
    setViewOnly(next)
    if (next && !tokens.view && canEdit && hasFirebase) setTokens(await resetInviteTokens(TRIP.id))
  }
  const url = viewOnly ? inviteUrl(TRIP.id, tokens.view, true) : inviteUrl(TRIP.id, tokens.edit)
  const ready = !hasFirebase || (viewOnly ? Boolean(tokens.view) : canEdit)

  // A link sent to the wrong group, or forwarded further than meant, used to
  // be a key nobody could take back. A new token makes every earlier link
  // stop working; people already on the trip are not affected.
  const resetLink = async () => {
    const ok = await confirm({
      title: t('ליצור קישור הזמנה חדש?'),
      body: t('הקישור הקודם יפסיק לעבוד, וכל מי שינסה להצטרף דרכו יידחה. מי שכבר בטיול נשאר בו.'),
      action: t('צור קישור חדש'),
      danger: false,
    })
    if (!ok) return
    setTokens(await resetInviteTokens(TRIP.id))
    setResetDone(true)
    setTimeout(() => setResetDone(false), 2400)
  }
  const joinedCount = headCount(FAMILIES.filter((f) => f.joined).map((f) => f.id), FAMILIES)

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <Sheet open={open} title={t('שתף את המסלול')} onClose={onClose}>
      <p className="sub" style={{ marginBottom: 16 }}>
        {t('כל מי שיצטרף רואה את אותו מסלול, ועדכונים מופיעים אצל כולם.')}
      </p>

      {/* Two links, two levels of access. Grandparents following along, or
          a group chat that should see the plan but not rearrange it, get
          the view-only one. Enforced by the security rules, not only here. */}
      {canEdit && (
        <>
          <span className="label">{t('מי שיצטרף בקישור יוכל')}</span>
          <div className="split-toggle share-access" role="radiogroup" aria-label={t('מי שיצטרף בקישור יוכל')}>
            <button role="radio" aria-checked={!viewOnly} className={!viewOnly ? 'on' : ''} onClick={() => chooseViewOnly(false)}>
              {t('לערוך')}
            </button>
            <button role="radio" aria-checked={viewOnly} className={viewOnly ? 'on' : ''} onClick={() => chooseViewOnly(true)}>
              {t('רק לצפות')}
            </button>
          </div>
        </>
      )}
      {!canEdit && (
        <p className="tiny" style={{ marginBottom: 14 }}>
          {t('יש לך הרשאת צפייה, ולכן אפשר לשתף רק קישור לצפייה.')}
        </p>
      )}

      {/* Message preview — text and url ship as separate fields (see
          shareTrip), but shown together here since that's what the
          recipient actually ends up seeing once WhatsApp stitches them back
          into one message. */}
      <div
        className="card"
        style={{ background: 'var(--sunken)', marginBottom: 16, maxHeight: 150, overflowY: 'auto' }}
      >
        <pre
          style={{
            margin: 0, fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.75,
            color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {text}
          {'\n\n'}
          {url}
        </pre>
      </div>

      <button
        className="btn btn-block"
        style={{ background: '#25D366', color: '#06281A', marginBottom: 10 }}
        onClick={() => shareTrip(text, url)}
        disabled={!ready}
      >
        <WhatsApp size={19} />
        {t('שלח בוואטסאפ')}
      </button>

      {/* One thing to share, not two — the "code" that used to sit beside
          this was the exact same id already inside the link, copied to a
          second button with nowhere of its own to be used. The join field
          in the account sheet now reads a pasted link just as well as a
          bare code, so the link alone covers every way of sharing this. */}
      <button className="btn btn-ghost btn-block" style={{ marginBottom: 8 }} onClick={copy} disabled={!ready}>
        {copied ? <Check size={16} /> : <LinkIcon size={16} />}
        {copied ? t('הקישור הועתק') : t('העתק קישור')}
      </button>
      {canEdit ? (
        <button className="erase-link" style={{ marginBottom: 18, marginTop: 4 }} onClick={resetLink}>
          {resetDone ? t('נוצר קישור חדש — הקודם כבר לא עובד') : t('הקישור הגיע למי שלא צריך? צור קישור חדש')}
        </button>
      ) : <div style={{ height: 14 }} />}

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <span style={{ color: 'var(--lav)' }}><Users size={17} /></span>
        <h3 className="h3">{t('מי כבר בטיול')}</h3>
        <span className="badge" style={{ marginInlineStart: 'auto' }}>
          <span className="num">{joinedCount}</span> {tn(joinedCount, 'נוסע', 'נוסעים')}
        </span>
      </div>

      <div className="card" style={{ paddingBlock: 4 }}>
        {FAMILIES.map((f) => (
          <div key={f.id} className="expense-row">
            <span className="avatar" style={{ background: f.color, width: 34, height: 34 }}>
              {f.short}
            </span>
            <span className="grow col" style={{ gap: 2 }}>
              <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{f.name || t('הנוסעים שלנו')}</strong>
              <span className="tiny">
                <span className="num">{f.members.length}</span> {tn(f.members.length, 'נוסע', 'נוסעים')}
              </span>
            </span>
            {f.joined ? (
              <span className="badge badge-live" style={{ color: 'var(--emerald)' }}>
                <i className="dot" /> {t('הצטרף')}
              </span>
            ) : (
              <span className="tiny">{t('ממתין')}</span>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  )
}
