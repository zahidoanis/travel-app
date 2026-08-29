import { useState } from 'react'
import Sheet from './Sheet'
import { WhatsApp, Check, Users, Link as LinkIcon } from './Icons'
import { headCount } from '../data'
import { useTrip } from '../TripProvider'
import { inviteText, inviteUrl, shareTrip, copyText } from '../lib/share'

export default function ShareSheet({ open, stops, onClose }) {
  const { trip: TRIP, families: FAMILIES } = useTrip()
  const [copied, setCopied] = useState(null)

  if (!TRIP) return null

  const text = inviteText(TRIP, stops, TRIP.id)
  const url = inviteUrl(TRIP.id)

  const copy = async () => {
    if (await copyText(url)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <Sheet open={open} title="שתף את המסלול" onClose={onClose}>
      <p className="sub" style={{ marginBottom: 16 }}>
        כל מי שיצטרף רואה את אותו מסלול, ועדכונים מופיעים אצל כולם.
      </p>

      {/* Message preview */}
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
        </pre>
      </div>

      <button
        className="btn btn-block"
        style={{ background: '#25D366', color: '#06281A', marginBottom: 10 }}
        onClick={() => shareTrip(text)}
      >
        <WhatsApp size={19} />
        שלח בוואטסאפ
      </button>

      {/* One thing to share, not two — the "code" that used to sit beside
          this was the exact same id already inside the link, copied to a
          second button with nowhere of its own to be used. The join field
          in the account sheet now reads a pasted link just as well as a
          bare code, so the link alone covers every way of sharing this. */}
      <button className="btn btn-ghost btn-block" style={{ marginBottom: 22 }} onClick={copy}>
        {copied ? <Check size={16} /> : <LinkIcon size={16} />}
        {copied ? 'הקישור הועתק' : 'העתק קישור'}
      </button>

      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <span style={{ color: 'var(--lav)' }}><Users size={17} /></span>
        <h3 className="h3">מי כבר בטיול</h3>
        <span className="badge" style={{ marginInlineStart: 'auto' }}>
          <span className="num">{headCount(FAMILIES.filter((f) => f.joined).map((f) => f.id), FAMILIES)}</span> נוסעים
        </span>
      </div>

      <div className="card" style={{ paddingBlock: 4 }}>
        {FAMILIES.map((f) => (
          <div key={f.id} className="expense-row">
            <span className="avatar" style={{ background: f.color, width: 34, height: 34 }}>
              {f.short}
            </span>
            <span className="grow col" style={{ gap: 2 }}>
              <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{f.name}</strong>
              <span className="tiny">
                <span className="num">{f.members.length}</span> נוסעים
              </span>
            </span>
            {f.joined ? (
              <span className="badge badge-live" style={{ color: 'var(--emerald)' }}>
                <i className="dot" /> הצטרף
              </span>
            ) : (
              <span className="tiny">ממתין</span>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  )
}
