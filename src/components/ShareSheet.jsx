import { useState } from 'react'
import Sheet from './Sheet'
import { WhatsApp, Check, Users, Link as LinkIcon } from './Icons'
import { headCount } from '../data'
import { useTrip } from '../TripProvider'
import { useConfirm } from './Confirm'
import { newId } from '../lib/ids'
import { inviteText, inviteUrl, shareTrip, copyText } from '../lib/share'
import { t, tn } from '../i18n'

export default function ShareSheet({ open, stops, onClose }) {
  const { trip: TRIP, families: FAMILIES, updateTrip } = useTrip()
  const confirm = useConfirm()
  const [resetDone, setResetDone] = useState(false)
  const [copied, setCopied] = useState(null)

  if (!TRIP) return null

  const text = inviteText(TRIP, stops, TRIP.id)
  const url = inviteUrl(TRIP.id, TRIP.inviteToken)

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
    await updateTrip({ inviteToken: newId() })
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

      {/* Message preview — text and url ship as separate fields (see
          shareTrip), but shown together here since that's what the
          recipient actually ends up seeing once WhatsApp stitches them back
          into one message. */}
      <div
        className="card"
        style={{ background: '#16141F', marginBottom: 16, maxHeight: 150, overflowY: 'auto' }}
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
      >
        <WhatsApp size={19} />
        {t('שלח בוואטסאפ')}
      </button>

      {/* One thing to share, not two — the "code" that used to sit beside
          this was the exact same id already inside the link, copied to a
          second button with nowhere of its own to be used. The join field
          in the account sheet now reads a pasted link just as well as a
          bare code, so the link alone covers every way of sharing this. */}
      <button className="btn btn-ghost btn-block" style={{ marginBottom: 8 }} onClick={copy}>
        {copied ? <Check size={16} /> : <LinkIcon size={16} />}
        {copied ? t('הקישור הועתק') : t('העתק קישור')}
      </button>
      <button className="erase-link" style={{ marginBottom: 18, marginTop: 4 }} onClick={resetLink}>
        {resetDone ? t('נוצר קישור חדש — הקודם כבר לא עובד') : t('הקישור הגיע למי שלא צריך? צור קישור חדש')}
      </button>

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
