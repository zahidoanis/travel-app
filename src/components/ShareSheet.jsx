import { useState } from 'react'
import Sheet from './Sheet'
import { WhatsApp, Copy, Check, Users, Link as LinkIcon } from './Icons'
import { headCount } from '../data'
import { useTrip } from '../TripProvider'
import { inviteText, inviteUrl, shareTrip, copyText } from '../lib/share'

export default function ShareSheet({ open, stops, onClose }) {
  const { trip: TRIP, families: FAMILIES } = useTrip()
  const [copied, setCopied] = useState(null)

  if (!TRIP) return null

  const text = inviteText(TRIP, stops, TRIP.id)
  const url = inviteUrl(TRIP.id)

  const copy = async (what, value) => {
    if (await copyText(value)) {
      setCopied(what)
      setTimeout(() => setCopied(null), 1600)
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
        onClick={() => shareTrip(text, url)}
      >
        <WhatsApp size={19} />
        שלח בוואטסאפ
      </button>

      <div className="row" style={{ gap: 10, marginBottom: 22 }}>
        <button className="btn btn-ghost grow" onClick={() => copy('link', url)}>
          {copied === 'link' ? <Check size={16} /> : <LinkIcon size={16} />}
          {copied === 'link' ? 'הקישור הועתק' : 'העתק קישור'}
        </button>
        <button className="btn btn-ghost grow" onClick={() => copy('code', TRIP.id)}>
          {copied === 'code' ? <Check size={16} /> : <Copy size={16} />}
          {copied === 'code' ? 'הקוד הועתק' : `קוד ${TRIP.id}`}
        </button>
      </div>

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
