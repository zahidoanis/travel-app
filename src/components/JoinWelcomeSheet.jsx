import { useState } from 'react'
import Sheet from './Sheet'
import { Route, Wallet, Users, Check, Plus } from './Icons'
import { useTrip } from '../TripProvider'
import { TIME_OPTIONS } from '../data'
import DateRangeCalendar from './DateRangeCalendar'

/**
 * Shown once, right after joining someone else's trip by link or by code.
 * Landing silently inside a shared plan with no explanation of what you can
 * actually do with it was the gap — this is the one-time orientation.
 *
 * It opens on a question the old version skipped entirely: *which* family
 * is this? Joining never assigns anyone to a party — without asking, every
 * joiner defaulted to whichever family the trip's creator happens to be,
 * silently editing that family's plan instead of their own. Picking an
 * existing family just remembers the choice on this device; picking "new"
 * collects that family's own real arrival/departure instead of the trip's
 * creator guessing on their behalf.
 */
export default function JoinWelcomeSheet() {
  const { justJoined, dismissJustJoined, trip, families, setMyFamily, addFamily } = useTrip()
  const [stage, setStage] = useState('pick')
  const [name, setName] = useState('')
  const [membersText, setMembersText] = useState('')
  const [arriveAt, setArriveAt] = useState('')
  const [departAt, setDepartAt] = useState('')
  const [saving, setSaving] = useState(false)

  if (!trip) return null

  const reset = () => {
    setStage('pick')
    setName('')
    setMembersText('')
    setArriveAt('')
    setDepartAt('')
  }

  const close = () => {
    reset()
    dismissJustJoined()
  }

  const pickExisting = (id) => {
    setMyFamily(id)
    setStage('info')
  }

  const createFamily = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    const id = await addFamily({
      name,
      members: membersText.split(',').filter((m) => m.trim()),
      arriveAt: arriveAt && `${arriveAt}`,
      departAt: departAt && `${departAt}`,
    })
    setSaving(false)
    if (id) {
      setMyFamily(id)
      setStage('info')
    }
  }

  if (stage === 'pick') {
    return (
      <Sheet open={justJoined} title="איזו משפחה אתם?" onClose={close}>
        <p className="sub" style={{ marginBottom: 16 }}>
          הצטרפתם לטיול ל{trip.city}! נשאר רק לדעת עם מי אנחנו.
        </p>
        <div className="col" style={{ gap: 8, marginBottom: 16 }}>
          {families.map((f) => (
            <button
              key={f.id}
              className="choice"
              style={{ padding: 13 }}
              onClick={() => pickExisting(f.id)}
            >
              <span className="row" style={{ gap: 10 }}>
                <i className="dot" style={{ background: f.color }} />
                <span className="grow" style={{ textAlign: 'start' }}>
                  <span className="choice-title" style={{ marginTop: 0 }}>{f.name}</span>
                  <span className="choice-sub tiny">
                    <span className="num">{f.members.length}</span> נוסעים
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-block" onClick={() => setStage('newFamily')}>
          <Plus size={16} />
          אני משפחה חדשה
        </button>
      </Sheet>
    )
  }

  if (stage === 'newFamily') {
    return (
      <Sheet open={justJoined} title="המשפחה שלכם" onClose={close}>
        <p className="sub" style={{ marginBottom: 16 }}>
          הפרטים האלה שלכם בלבד — כולל מתי אתם בפועל מגיעים ועוזבים.
        </p>

        <span className="label">שם המשפחה</span>
        <input
          className="field" style={{ marginBottom: 14 }}
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="לדוגמה: כהן"
          aria-label="שם המשפחה"
        />

        <span className="label">משתתפים (מופרדים בפסיק)</span>
        <input
          className="field" style={{ marginBottom: 14 }}
          value={membersText} onChange={(e) => setMembersText(e.target.value)}
          placeholder="דנה, יוסי, נועה"
          aria-label="שמות המשתתפים"
        />

        <div style={{ marginBottom: 14 }}>
          <DateRangeCalendar
            from={arriveAt.split('T')[0] ?? ''}
            to={departAt.split('T')[0] ?? ''}
            min={trip.from}
            onChange={({ from, to }) => {
              setArriveAt(from ? `${from}T${arriveAt.split('T')[1] ?? '00:00'}` : '')
              setDepartAt(to ? `${to}T${departAt.split('T')[1] ?? '00:00'}` : '')
            }}
          />
        </div>

        <div className="date-grid" style={{ marginBottom: 18 }}>
          <label className="date-cell">
            <span className="label">שעת הגעה</span>
            <select
              className="field"
              value={arriveAt.split('T')[1] ?? ''}
              onChange={(e) => setArriveAt(`${arriveAt.split('T')[0] || trip.from}T${e.target.value || '00:00'}`)}
              aria-label="שעת הגעה"
            >
              <option value="">בחר שעה</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="date-cell">
            <span className="label">שעת עזיבה</span>
            <select
              className="field"
              value={departAt.split('T')[1] ?? ''}
              onChange={(e) => setDepartAt(`${departAt.split('T')[0] || trip.to}T${e.target.value || '00:00'}`)}
              aria-label="שעת עזיבה"
            >
              <option value="">בחר שעה</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <button className="btn btn-primary btn-block" onClick={createFamily} disabled={!name.trim() || saving}>
          {saving ? <span className="typing"><i /><i /><i /></span> : <><Check size={17} /> המשך</>}
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet open={justJoined} title={`הצטרפת לטיול ל${trip.city}!`} onClose={close}>
      <p className="sub" style={{ marginBottom: 18 }}>
        {families.length > 1
          ? 'כל משפחה מתכננת את הימים שלה בנפרד — אפשר לעבור בין המשפחות ולערוך את כולן, ולסמן ימים שנמצאים ביחד כ"יחד" כדי לתכנן אותם על אותו לו"ז משותף.'
          : 'זה מסלול אחד משותף — לא עותק אישי. כל שינוי שמישהו עושה מופיע אצל כולם באותו רגע.'}
      </p>

      <div className="col" style={{ gap: 12, marginBottom: 22 }}>
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span className="contact-icon"><Route size={15} /></span>
          <span className="tiny" style={{ lineHeight: 1.6 }}>
            אפשר לערוך את הלו"ז — להוסיף עצירות, לשנות סדר — בדיוק כמו כל
            חבר אחר בטיול.
          </span>
        </div>
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span className="contact-icon"><Wallet size={15} /></span>
          <span className="tiny" style={{ lineHeight: 1.6 }}>
            הוצאות ורשימת הערות משותפות לכל הטיול, לא לפי משפחה.
          </span>
        </div>
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span className="contact-icon"><Users size={15} /></span>
          <span className="tiny" style={{ lineHeight: 1.6 }}>
            מי כבר הצטרף אפשר לראות בכפתור השיתוף במסך הבית.
          </span>
        </div>
      </div>

      <button className="btn btn-primary btn-block" onClick={close}>
        <Check size={17} />
        הבנתי, בואו נתחיל
      </button>
    </Sheet>
  )
}
