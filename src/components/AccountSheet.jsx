import { useState } from 'react'
import Sheet from './Sheet'
import { Check, Users, Info, X, Plus, Pencil, Share, Trash } from './Icons'
import { useTrip } from '../TripProvider'
import { joinTrip, claimOwnership, removeMember, inviteTokens, deleteAccountData, clearLocalData } from '../lib/db'
import { signInWithGoogle, signOutUser, deleteAuthAccount, hasFirebase } from '../lib/firebase'
import { breadcrumb } from '../lib/telemetry'
import { initials } from '../lib/text'
import { inviteUrl, shareTrip } from '../lib/share'
import { placeNames } from '../lib/placeNames'
import { t } from '../i18n'
import LangToggle from './LangToggle'
import LegalLinks from './LegalLinks'
import ConsentNote from './ConsentNote'
import EditTripSheet from './EditTripSheet'

/**
 * Saving the trip to an account.
 *
 * Framed as "open it from your phone too", not as "register" — the first
 * describes a benefit, the second describes work. It is offered once a trip
 * exists, so the thing being protected is already visible.
 */
export default function AccountSheet({ open, onClose }) {
  const { user, trip, trips, switchTrip, startNewTrip, openEdit, removeTrip, profile } = useTrip()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [merged, setMerged] = useState(false)
  // The trip a delete was requested for, awaiting confirmation — not gone
  // on the first tap. Deleting is permanent and removes it for everyone on
  // the trip, not just this device, which is a different order of risk than
  // anything else this sheet does.
  const [deletingTrip, setDeletingTrip] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  // Deleting the whole account — its own confirmation, same reason.
  const [erasing, setErasing] = useState(false)
  const [eraseBusy, setEraseBusy] = useState(false)
  const [eraseError, setEraseError] = useState(null)
  const [editPicker, setEditPicker] = useState(false)

  const connect = async () => {
    setBusy(true)
    setError(null)
    // Captured before signing in, because the uid can change underneath us.
    const carried = trip?.id
    const oldUid = user?.uid
    const wasOwner = trip?.ownerId === oldUid
    // The account joins with the same rights this device had, and with the
    // token for those rights — read now, while this device can still read
    // it. It used to rejoin with the edit link whatever the role, which
    // turned a viewer into an editor.
    const carriedRole = trip?.members?.[oldUid] === 'viewer' ? 'viewer' : 'editor'
    const tokens = carried ? await inviteTokens(carried) : {}
    const carriedToken = carriedRole === 'viewer' ? tokens.view : tokens.edit
    try {
      const result = await signInWithGoogle()
      breadcrumb('lifecycle', `signed in${result.merged ? ' (merged)' : ''}`)

      // Linking keeps the uid, so the trip on this device is still ours.
      // Landing on an account that already existed does not — the trip would
      // stay behind with the anonymous uid that made it, and this sheet
      // promises the opposite. Joining is the same path a shared link takes.
      if (result.merged && carried) {
        await joinTrip(carried, carriedToken, carriedRole)
        // Only when this device actually created the trip — a family member
        // who had merely joined someone else's shared trip must not walk
        // away owning it just because they were the one who happened to
        // sign in on this device.
        if (wasOwner) await claimOwnership(carried)
        // The anonymous account this device used is gone for good; leaving
        // it on the member list meant that deleting the real account later
        // could hand the trip to it — an owner nobody can ever sign in as.
        if (carriedRole !== 'viewer') await removeMember(carried, oldUid)
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
  const ownsCurrent = Boolean(trip && user && trip.ownerId === user.uid)
  const askDeleteCurrent = () => {
    setDeleteError(null)
    setDeletingTrip({ id: trip.id, destination: trip.city, destinationEn: trip.cityEn, country: trip.country })
  }

  // Data first, sign-in last: the Firestore deletes need the account that is
  // about to go. If the data half fails nothing else is touched, so trying
  // again picks up where it stopped; if only the sign-in half fails (Google
  // wanted a fresh confirmation and the popup was dismissed) the data is
  // already gone and a second attempt just finishes the job.
  const eraseAccount = async () => {
    setEraseBusy(true)
    setEraseError(null)
    try {
      const ok = await deleteAccountData()
      if (!ok && hasFirebase) throw new Error(t('המחיקה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.'))
      await deleteAuthAccount()
    } catch (err) {
      setEraseBusy(false)
      setEraseError(
        err?.code?.startsWith?.('auth/')
          ? t('המידע נמחק, אבל מחיקת החשבון עצמו דורשת אישור מחדש מול Google. נסו שוב.')
          : err.message
      )
      return
    }
    breadcrumb('lifecycle', 'account deleted')
    clearLocalData()
    // A full reload, not a state reset: every screen holds something of the
    // account that no longer exists, and the app starts clean from here.
    location.replace('/')
  }

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
    setEditPicker(true)
  }

  // Opens the editor right at the part that was picked.
  const pickSection = (id) => {
    setEditPicker(false)
    openEdit(id)
    onClose()
  }

  // Editing a trip other than the one currently open has to load it first —
  // the wizard reads straight off the active trip's stored answers.
  const editTripRow = async (tr) => {
    if (tr.id !== trip?.id) await switchTrip(tr.id)
    setEditPicker(true)
  }

  // No full itinerary preview here, unlike sharing the active trip from
  // Home — that needs today's stops loaded, which a trip elsewhere in this
  // list isn't. Just the destination and the join link, which is already
  // everything a recipient needs to get in.
  //
  // The link matches what this account may do on that trip: a viewer passes
  // on the view-only link. This button always sent the edit link before,
  // so any viewer could forward edit access.
  const shareTripRow = async (tr) => {
    const viewOnly = tr.members?.[user?.uid] === 'viewer'
    const tokens = await inviteTokens(tr.id)
    if (viewOnly && !tokens.view) return
    // Link rides as its own `url` field, not inline in `text` — see
    // share.js's inviteText comment for why: that's what gets WhatsApp to
    // unfurl it into a real preview card instead of a bare line of text.
    shareTrip(
      t('הצטרפו אליי לטיול ל{city}! 🗺️', { city: placeNames(tr).city }),
      viewOnly ? inviteUrl(tr.id, tokens.view, true) : inviteUrl(tr.id, tokens.edit)
    )
  }

  const confirmDelete = async () => {
    setDeleting(true)
    const result = await removeTrip(deletingTrip.id)
    setDeleting(false)

    if (!result.ok) {
      setDeleteError(t('המחיקה נכשלה — רק מי שיצר את הטיול יכול למחוק אותו.'))
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
    <Sheet open={open} title={signedIn ? t('החשבון שלך') : t('שמור את הטיול')} onClose={onClose}>
      {!hasFirebase && (
        <>
          <p className="sub" style={{ marginBottom: 18 }}>
            {t('אחסון בענן אינו מוגדר. הטיול נשמר על המכשיר הזה בלבד.')}
          </p>
          <button className="btn btn-ghost btn-block" onClick={editTrip} disabled={!trip} style={{ marginBottom: 10 }}>
            {t('ערוך פרטי טיול')}
          </button>
          <button className="btn btn-primary btn-block" onClick={planAnother}>
            <Plus size={16} />
            {t('תכנן טיול נוסף')}
          </button>
          <p className="tiny" style={{ marginTop: 10 }}>
            {t('הטיול הנוכחי לא נמחק, אבל בלי חיבור לענן אין רשימה שממנה אפשר לחזור אליו.')}
          </p>
        </>
      )}

      {hasFirebase && !signedIn && (
        <>
          <p className="sub" style={{ marginBottom: 18 }}>
            {t('כרגע הטיול קיים')} <strong>{t('רק על המכשיר הזה')}</strong>{t('. התחברות שומרת אותו בענן, כך שתוכל לפתוח אותו מהטלפון ומהמחשב — ולהמשיך בדיוק מאותה נקודה.')}
          </p>

          <button className="btn btn-primary btn-block" onClick={connect} disabled={busy}>
            {busy ? <span className="typing"><i /><i /><i /></span> : <GoogleMark />}
            {t('המשך עם Google')}
          </button>

          {error && (
            <p className="tiny" style={{ color: 'var(--rose)', marginTop: 12 }}>{error}</p>
          )}

          <div className="row" style={{ alignItems: 'flex-start', gap: 9, marginTop: 16 }}>
            <span style={{ color: 'var(--muted)' }}><Info size={14} /></span>
            <p className="tiny" style={{ margin: 0 }}>
              {t('שום דבר ממה שכבר תכננת לא יאבד — החשבון הנוכחי משודרג, לא מוחלף. אנחנו לא מקבלים גישה לגוגל שלך מעבר לשם ולכתובת המייל.')}
            </p>
          </div>
          <ConsentNote style={{ marginTop: 10 }} />

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 18 }}>
            <button className="btn btn-ghost btn-block" onClick={editTrip} disabled={!trip} style={{ marginBottom: 10 }}>
              {t('ערוך פרטי טיול')}
            </button>
            <button className="btn btn-ghost btn-block" onClick={planAnother}>
              <Plus size={16} />
              {t('תכנן טיול נוסף בלי להתחבר')}
            </button>
            <p className="tiny" style={{ marginTop: 10 }}>
              {t('בלי להתחבר, הטיול הנוכחי לא יופיע יותר ברשימה — ההתחברות למעלה היא הדרך היחידה לשמור גישה לשניהם.')}
            </p>
            {ownsCurrent && (
              <button className="btn btn-ghost btn-block danger-text" onClick={askDeleteCurrent} style={{ marginTop: 14 }}>
                <Trash size={16} />
                {t('מחק את הטיול הזה')}
              </button>
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
                  {initials(user.name) || '?'}
                </span>
              )}
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <strong style={{ fontSize: 14.5, fontWeight: 600 }}>{user.name || t('מחובר')}</strong>
                <span className="tiny stay-address">{user.email}</span>
              </span>
              <span className="badge" style={{ color: 'var(--emerald)' }}>
                <Check size={11} /> {t('מסונכרן')}
              </span>
            </div>
          </div>

          {merged && (
            <p className="tiny" style={{ color: 'var(--emerald)', marginBottom: 16 }}>
              {t('המכשיר הזה חובר לחשבון הקיים שלך — הטיולים שלך כאן.')}
            </p>
          )}

          {/* First actions in the sheet, not last — these are what people
              come back for once they already have a trip saved. */}
          <button className="btn btn-ghost btn-block" onClick={editTrip} disabled={!trip} style={{ marginBottom: 10 }}>
            {t('ערוך פרטי טיול')}
          </button>
          <button className="btn btn-primary btn-block" onClick={planAnother} style={{ marginBottom: 20 }}>
            <Plus size={16} />
            {t('טיול נוסף')}
          </button>

          {trips.length > 0 && (
            <>
              <span className="label"><Users size={13} /> {t('הטיולים שלך')}</span>
              <div className="col" style={{ gap: 8, marginBottom: 18 }}>
                {trips.map((tr) => (
                  <div key={tr.id} className={`choice ${tr.id === trip?.id ? 'on' : ''}`} style={{ padding: 13 }}>
                    <span className="between" style={{ gap: 8 }}>
                      <button
                        className="grow"
                        style={{ textAlign: 'start' }}
                        onClick={() => { switchTrip(tr.id); onClose() }}
                      >
                        <span className="choice-title" style={{ marginTop: 0 }}>{placeNames(tr).city}</span>
                        <span className="choice-sub num">{tr.from} → {tr.to}</span>
                      </button>
                      {tr.id === trip?.id && <Check size={16} />}
                      <button
                        className="icon-btn"
                        onClick={() => shareTripRow(tr)}
                        aria-label={t('שתף את הטיול ל{city}', { city: placeNames(tr).city })}
                      >
                        <Share size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => editTripRow(tr)}
                        aria-label={t('ערוך את הטיול ל{city}', { city: placeNames(tr).city })}
                      >
                        <Pencil size={14} />
                      </button>
                      {/* firebase.rules restricts deletion to whoever created
                          the trip — showing this to every member would just
                          be an button that fails for most people who tap it. */}
                      {tr.ownerId === user.uid && (
                        <button
                          className="icon-btn"
                          onClick={() => { setDeleteError(null); setDeletingTrip(tr) }}
                          aria-label={t('מחק את הטיול ל{city}', { city: placeNames(tr).city })}
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
            {t('התנתק מהמכשיר הזה')}
          </button>
          <p className="tiny" style={{ marginTop: 10 }}>
            {t('הטיולים יישארו בחשבון. התחברות חוזרת תחזיר אותם.')}
          </p>
        </>
      )}

      <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center' }}>
        <LangToggle up />
      </div>

      <LegalLinks className="sheet-legal" />
      <button className="erase-link" onClick={() => { setEraseError(null); setErasing(true) }}>
        {t('מחיקת החשבון וכל המידע')}
      </button>
    </Sheet>

    <EditTripSheet open={editPicker} profile={profile} onClose={() => setEditPicker(false)} onPick={pickSection} />

    <Sheet
      open={erasing}
      title={t('מחיקת החשבון')}
      onClose={() => { if (!eraseBusy) setErasing(false) }}
    >
      <p className="sub" style={{ marginBottom: 12 }}>
        {t('הפעולה מוחקת את פרטי החשבון, את הטיולים שרק אתם חברים בהם ואת כל מה שנשמר במכשיר הזה.')}{' '}
        <strong>{t('לא ניתן לבטל אותה.')}</strong>
      </p>
      <p className="tiny" style={{ marginBottom: 20 }}>
        {t('טיולים משותפים יישארו אצל שאר החברים, בלעדיכם.')}
      </p>
      {eraseError && (
        <p className="tiny" role="alert" style={{ color: 'var(--rose)', marginBottom: 14 }}>{eraseError}</p>
      )}
      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-ghost btn-block grow" onClick={() => setErasing(false)} disabled={eraseBusy}>
          {t('ביטול')}
        </button>
        <button
          className="btn btn-block grow"
          style={{ background: 'var(--rose)', color: '#fff' }}
          onClick={eraseAccount}
          disabled={eraseBusy}
        >
          {eraseBusy ? <span className="typing"><i /><i /><i /></span> : t('מחק לצמיתות')}
        </button>
      </div>
    </Sheet>

    <Sheet
      open={deletingTrip !== null}
      title={t('מחיקת טיול')}
      onClose={() => { if (!deleting) { setDeletingTrip(null); setDeleteError(null) } }}
    >
      {deletingTrip && (
        <>
          <p className="sub" style={{ marginBottom: 20 }}>
            {t('למחוק את הטיול ל')}<strong>{placeNames(deletingTrip).city}</strong>?{' '}
            {t('הפעולה מוחקת אותו')} <strong>{t('לצמיתות עבור כל מי שבטיול')}</strong>{t(', ולא ניתן לבטל אותה.')}
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
              {t('ביטול')}
            </button>
            <button
              className="btn btn-block grow"
              style={{ background: 'var(--rose)', color: '#fff' }}
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <span className="typing"><i /><i /><i /></span> : t('מחק לצמיתות')}
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
