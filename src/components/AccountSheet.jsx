import { useState } from 'react'
import Sheet from './Sheet'
import { Check, Users, Info, Globe, X, Plus } from './Icons'
import { useTrip } from '../TripProvider'
import { joinTrip } from '../lib/db'
import { signInWithGoogle, signOutUser, hasFirebase } from '../lib/firebase'
import { breadcrumb } from '../lib/telemetry'

/**
 * Saving the trip to an account.
 *
 * Framed as "open it from your phone too", not as "register" — the first
 * describes a benefit, the second describes work. It is offered once a trip
 * exists, so the thing being protected is already visible.
 */
export default function AccountSheet({ open, onClose }) {
  const { user, trip, trips, switchTrip, startNewTrip, joinByCode, openEdit, removeTrip } = useTrip()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [merged, setMerged] = useState(false)
  const [code, setCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)
  // The trip a delete was requested for, awaiting confirmation — not gone
  // on the first tap. Deleting is permanent and removes it for everyone on
  // the trip, not just this device, which is a different order of risk than
  // anything else this sheet does.
  const [deletingTrip, setDeletingTrip] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const connect = async () => {
    setBusy(true)
    setError(null)
    // Captured before signing in, because the uid can change underneath us.
    const carried = trip?.id
    try {
      const result = await signInWithGoogle()
      breadcrumb('lifecycle', `signed in${result.merged ? ' (merged)' : ''}`)

      // Linking keeps the uid, so the trip on this device is still ours.
      // Landing on an account that already existed does not — the trip would
      // stay behind with the anonymous uid that made it, and this sheet
      // promises the opposite. Joining is the same path a shared link takes.
      if (result.merged && carried) {
        await joinTrip(carried)
        breadcrumb('lifecycle', `carried trip ${carried} into the account`)
      }

      setMerged(result.merged)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    await signOutUser()
    setBusy(false)
    onClose()
  }

  const signedIn = user && !user.anonymous

  const planAnother = () => {
    startNewTrip()
    onClose()
  }

  // Guarded here, not just by disabling the buttons below — this sheet is
  // now reachable from Welcome, before any trip exists (signed in with an
  // account that has trips, but none picked yet). The editor reads straight
  // off the current trip's stored answers, which would be null there.
  const editTrip = () => {
    if (!trip) return
    openEdit('where')
    onClose()
  }

  const joinNow = async () => {
    setJoining(true)
    setJoinError(null)
    const result = await joinByCode(code)
    setJoining(false)
    if (result.ok) onClose()
    else setJoinError(result.message)
  }

  const confirmDelete = async () => {
    setDeleting(true)
    const result = await removeTrip(deletingTrip.id)
    setDeleting(false)

    if (!result.ok) {
      setDeleteError('המחיקה נכשלה — רק מי שיצר את הטיול יכול למחוק אותו.')
      return
    }

    setDeletingTrip(null)
    // Only close the whole sheet if that was the trip open behind it — a
    // deletion elsewhere in the list shouldn't kick you out of your own
    // account view.
    if (deletingTrip.id === trip?.id) onClose()
  }

  return (
    <>
    <Sheet open={open} title={signedIn ? 'החשבון שלך' : 'שמור את הטיול'} onClose={onClose}>
      {!hasFirebase && (
        <>
          <p className="sub" style={{ marginBottom: 18 }}>
            אחסון בענן אינו מוגדר. הטיול נשמר על המכשיר הזה בלבד.
          </p>
          <button className="btn btn-ghost btn-block" onClick={editTrip} disabled={!trip} style={{ marginBottom: 10 }}>
            ערוך פרטי טיול
          </button>
          <button className="btn btn-primary btn-block" onClick={planAnother}>
            <Plus size={16} />
            תכנן טיול נוסף
          </button>
          <p className="tiny" style={{ marginTop: 10 }}>
            הטיול הנוכחי לא נמחק, אבל בלי חיבור לענן אין רשימה שממנה אפשר
            לחזור אליו.
          </p>
        </>
      )}

      {hasFirebase && !signedIn && (
        <>
          <p className="sub" style={{ marginBottom: 18 }}>
            כרגע הטיול קיים <strong>רק על המכשיר הזה</strong>. התחברות שומרת אותו
            בענן, כך שתוכל לפתוח אותו מהטלפון ומהמחשב — ולהמשיך בדיוק מאותה נקודה.
          </p>

          <button className="btn btn-primary btn-block" onClick={connect} disabled={busy}>
            {busy ? <span className="typing"><i /><i /><i /></span> : <GoogleMark />}
            המשך עם Google
          </button>

          {error && (
            <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>
          )}

          <div className="row" style={{ alignItems: 'flex-start', gap: 9, marginTop: 16 }}>
            <span style={{ color: 'var(--muted)' }}><Info size={14} /></span>
            <p className="tiny" style={{ margin: 0 }}>
              שום דבר ממה שכבר תכננת לא יאבד — החשבון הנוכחי משודרג, לא מוחלף.
              אנחנו לא מקבלים גישה לגוגל שלך מעבר לשם ולכתובת המייל.
            </p>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
            <button className="btn btn-ghost btn-block" onClick={editTrip} disabled={!trip} style={{ marginBottom: 10 }}>
              ערוך פרטי טיול
            </button>
            <button className="btn btn-ghost btn-block" onClick={planAnother}>
              <Plus size={16} />
              תכנן טיול נוסף בלי להתחבר
            </button>
            <p className="tiny" style={{ marginTop: 10 }}>
              בלי להתחבר, הטיול הנוכחי לא יופיע יותר ברשימה — ההתחברות למעלה
              היא הדרך היחידה לשמור גישה לשניהם.
            </p>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
            <span className="label"><Globe size={13} /> יש לי קוד או קישור הצטרפות</span>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <input
                className="field grow"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="הדבק כאן את הקוד או הקישור שקיבלת"
              />
              <button className="btn btn-primary" onClick={joinNow} disabled={joining || !code.trim()}>
                {joining ? <span className="typing"><i /><i /><i /></span> : 'הצטרף'}
              </button>
            </div>
            {joinError && (
              <p className="tiny" style={{ color: 'var(--rose)', marginTop: 8 }}>{joinError}</p>
            )}
          </div>
        </>
      )}

      {hasFirebase && signedIn && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ gap: 11 }}>
              {user.photo ? (
                <img src={user.photo} alt="" className="account-photo" />
              ) : (
                <span className="avatar" style={{ background: 'var(--accent)' }}>
                  {(user.name || '?').charAt(0)}
                </span>
              )}
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: 14.5, fontWeight: 600 }}>{user.name || 'מחובר'}</strong>
                <span className="tiny stay-address">{user.email}</span>
              </span>
              <span className="badge" style={{ color: 'var(--emerald)' }}>
                <Check size={11} /> מסונכרן
              </span>
            </div>
          </div>

          {merged && (
            <p className="tiny" style={{ color: 'var(--emerald)', marginBottom: 16 }}>
              המכשיר הזה חובר לחשבון הקיים שלך — הטיולים שלך כאן.
            </p>
          )}

          {/* First actions in the sheet, not last — these are what people
              come back for once they already have a trip saved. */}
          <button className="btn btn-ghost btn-block" onClick={editTrip} disabled={!trip} style={{ marginBottom: 10 }}>
            ערוך פרטי טיול
          </button>
          <button className="btn btn-primary btn-block" onClick={planAnother} style={{ marginBottom: 20 }}>
            <Plus size={16} />
            טיול נוסף
          </button>

          <div style={{ marginBottom: 22 }}>
            <span className="label"><Globe size={13} /> יש לי קוד או קישור הצטרפות</span>
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <input
                className="field grow"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="הדבק כאן את הקוד או הקישור שקיבלת"
              />
              <button className="btn btn-ghost" onClick={joinNow} disabled={joining || !code.trim()}>
                {joining ? <span className="typing"><i /><i /><i /></span> : 'הצטרף'}
              </button>
            </div>
            {joinError && (
              <p className="tiny" style={{ color: 'var(--rose)', marginTop: 8 }}>{joinError}</p>
            )}
          </div>

          {trips.length > 0 && (
            <>
              <span className="label"><Users size={13} /> הטיולים שלך</span>
              <div className="col" style={{ gap: 8, marginBottom: 18 }}>
                {trips.map((t) => (
                  <div key={t.id} className={`choice ${t.id === trip?.id ? 'on' : ''}`} style={{ padding: 13 }}>
                    <span className="between" style={{ gap: 8 }}>
                      <button
                        className="grow"
                        style={{ textAlign: 'start' }}
                        onClick={() => { switchTrip(t.id); onClose() }}
                      >
                        <span className="choice-title" style={{ marginTop: 0 }}>{t.destination}</span>
                        <span className="choice-sub num">{t.from} → {t.to}</span>
                      </button>
                      {t.id === trip?.id && <Check size={16} />}
                      {/* firebase.rules restricts deletion to whoever created
                          the trip — showing this to every member would just
                          be an button that fails for most people who tap it. */}
                      {t.ownerId === user.uid && (
                        <button
                          className="icon-btn"
                          style={{ width: 32, height: 32 }}
                          onClick={() => { setDeleteError(null); setDeletingTrip(t) }}
                          aria-label={`מחק את הטיול ל${t.destination}`}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <button className="btn btn-ghost btn-block" onClick={disconnect} disabled={busy}>
            <X size={16} />
            התנתק מהמכשיר הזה
          </button>
          <p className="tiny" style={{ marginTop: 10 }}>
            הטיולים יישארו בחשבון. התחברות חוזרת תחזיר אותם.
          </p>
        </>
      )}
    </Sheet>

    <Sheet
      open={deletingTrip !== null}
      title="מחיקת טיול"
      onClose={() => { if (!deleting) { setDeletingTrip(null); setDeleteError(null) } }}
    >
      {deletingTrip && (
        <>
          <p className="sub" style={{ marginBottom: 20 }}>
            למחוק את הטיול ל<strong>{deletingTrip.destination}</strong>?
            הפעולה מוחקת אותו <strong>לצמיתות עבור כל מי שבטיול</strong>,
            ולא ניתן לבטל אותה.
          </p>
          {deleteError && (
            <p className="tiny" style={{ color: 'var(--rose)', marginBottom: 14 }}>{deleteError}</p>
          )}
          <div className="row" style={{ gap: 9 }}>
            <button
              className="btn btn-ghost btn-block grow"
              onClick={() => { setDeletingTrip(null); setDeleteError(null) }}
              disabled={deleting}
            >
              ביטול
            </button>
            <button
              className="btn btn-block grow"
              style={{ background: 'var(--rose)', color: '#fff' }}
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <span className="typing"><i /><i /><i /></span> : 'מחק לצמיתות'}
            </button>
          </div>
        </>
      )}
    </Sheet>
    </>
  )
}

/** Google's mark, so the button is recognisable at a glance. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5Z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2Z" />
      <path fill="#FBBC05" d="M10.4 28.7a14.5 14.5 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1Z" />
      <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.6l-7.5-5.8c-2.1 1.4-4.8 2.2-7.8 2.2-6.3 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48Z" />
    </svg>
  )
}
