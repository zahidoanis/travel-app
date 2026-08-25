import { useEffect, useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import {
  ArrowUpDown, RefreshCw, Users, Plus, Receipt, Check, Info, X,
} from '../components/Icons'
import { useTrip } from '../TripProvider'
import { SUPPORTED, SYMBOL, localCurrency, fetchRates, isConvertible } from '../lib/currency'

const fmt = (n) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Finance() {
  const {
    families: FAMILIES, trip,
    addExpense, updateExpense, removeExpense: removeExpenseFromTrip,
  } = useTrip()
  // Every traveller is a member of exactly one party.
  // "You" are the first member of the first party.
  // Members carry the names entered during onboarding.
  const MEMBERS = FAMILIES.flatMap((f) =>
    f.members.map((m) => ({
      id: m.id,
      name: m.name,
      short: m.name.trim().charAt(0) || f.short,
      color: f.color,
      family: f.id,
    }))
  )
  const ME = MEMBERS[0]?.id ?? null
  /* ---- converter ---- */

  // The currency you will actually be handing over at the destination. This
  // is always the real one — AED for Dubai, KES for Kenya — regardless of
  // whether the free rate feed below can convert it.
  const local = useMemo(
    () => localCurrency(trip?.country ?? '', trip?.city ?? ''),
    [trip?.country, trip?.city]
  )
  // Frankfurter (ECB) only tracks ~30 currencies. For everything outside
  // that — a third of the curated destination list — there is no free live
  // rate to show, so the calculator falls back to USD as a reference point
  // rather than silently mislabelling the destination's own currency.
  const localOk = isConvertible(local)

  // The amount you type is what you're carrying — shekels — so it starts on
  // "from", with the destination's currency as the answer on "to". It used
  // to be the other way around: typing "100" meant 100 of the destination's
  // currency, and the shekel side only ever showed as the *output*. Someone
  // who types "100 שקל" expecting to see it in euros got the euro amount
  // converted into more shekels instead — a real number, just answering a
  // question nobody asked.
  const [from, setFrom] = useState('ILS')
  const [to, setTo] = useState(localOk ? local : 'USD')
  const [amount, setAmount] = useState('100')
  const [spin, setSpin] = useState(false)
  const [rates, setRates] = useState(null)
  const [ratesError, setRatesError] = useState(false)

  // Follow the destination unless the user has picked something else.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched) setTo(localOk ? local : 'USD')
  }, [local, localOk, touched])

  // Live rates, quoted against ILS so every cross-rate goes through one base.
  useEffect(() => {
    let cancelled = false
    fetchRates('ILS').then((r) => {
      if (cancelled) return
      setRates(r)
      setRatesError(r === null)
    })
    return () => { cancelled = true }
  }, [])

  const rate = useMemo(() => {
    if (!rates) return null
    const f = rates.rates[from]
    const t = rates.rates[to]
    // rates are per 1 ILS, so ILS-per-unit is the reciprocal.
    return f && t ? t / f : null
  }, [rates, from, to])

  const converted = useMemo(() => {
    const n = parseFloat(amount)
    return Number.isFinite(n) && rate != null ? n * rate : 0
  }, [amount, rate])

  const swap = () => {
    setSpin((s) => !s)
    setFrom(to)
    setTo(from)
    // Otherwise the auto-follow effect immediately overwrites the swapped
    // "to" back to the destination currency, undoing the swap on next render.
    setTouched(true)
  }

  const expenses = trip?.expenses ?? []
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [payer, setPayer] = useState(null)
  const [saved, setSaved] = useState(false)
  // Set while editing an existing expense; null means the sheet is adding a
  // new one. Same sheet either way — the only difference is what it does on
  // save and whether a delete button shows up.
  const [editingId, setEditingId] = useState(null)

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)

  /* ---- how the bill is divided ---- */
  const [splitBy, setSplitBy] = useState('person')

  // MEMBERS is derived, so the default payer has to wait for it.
  const payerId = payer ?? ME

  // Per person everyone pays an equal share; per family each household pays one
  // share regardless of size — the usual arrangement when families travel together.
  const parties = useMemo(() => {
    if (splitBy === 'family') {
      return FAMILIES.map((f) => ({ ...f, size: f.members.length }))
        .filter((f) => !f.members.some((m) => m.id === ME))
    }
    return MEMBERS.filter((m) => m.id !== ME).map((m) => ({ ...m, size: 1 }))
  }, [splitBy, FAMILIES])

  const shares = splitBy === 'family' ? FAMILIES.length : MEMBERS.length

  // Net position of the first traveller: their share of everything, minus what
  // they fronted.
  const { owe, owed } = useMemo(() => {
    const myFamily = FAMILIES.find((f) => f.members.some((m) => m.id === ME))
    let balance = 0
    for (const e of expenses) {
      const share = e.amount / shares
      // Anyone in your household counts as you when splitting per family.
      const mine =
        splitBy === 'family'
          ? Boolean(myFamily?.members.some((m) => m.id === e.payer))
          : e.payer === ME
      if (mine) balance += e.amount - share
      else balance -= share
    }
    return { owe: balance < 0 ? Math.abs(balance) : 0, owed: balance > 0 ? balance : 0 }
  }, [expenses, shares, splitBy, FAMILIES, ME])

  const closeSheet = () => {
    setAddOpen(false)
    setEditingId(null)
    setTitle('')
    setValue('')
    setPayer(null)
  }

  const openEdit = (e) => {
    setEditingId(e.id)
    setTitle(e.title)
    setValue(String(e.amount))
    setPayer(e.payer)
    setAddOpen(true)
  }

  const saveExpense = () => {
    const n = parseFloat(value)
    if (!title.trim() || !Number.isFinite(n) || n <= 0) return

    if (editingId) {
      updateExpense(editingId, { title: title.trim(), payer: payerId, amount: n })
    } else {
      addExpense({ id: `e${Date.now()}`, title: title.trim(), payer: payerId, amount: n, split: shares })
    }

    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      closeSheet()
    }, 900)
  }

  const removeExpense = () => {
    removeExpenseFromTrip(editingId)
    closeSheet()
  }

  return (
    <>
      <div className="screen">
        <TopBar variant="brand" />

        <div className="pad between" style={{ alignItems: 'flex-start', marginTop: 6 }}>
          <div>
            <h1 className="h1" style={{ fontSize: 25 }}>פיננסים</h1>
            <p className="tiny" style={{ marginTop: 4 }}>מעקב הוצאות והמרת מטבע</p>
          </div>
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <span className="tiny">סה"כ הוצאות</span>
            <strong style={{ fontSize: 20, fontWeight: 700 }}>
              <span className="num">₪{total.toLocaleString('en-US')}</span>
            </strong>
          </div>
        </div>

        {/* ---- currency converter ---- */}
        <div className="pad" style={{ marginTop: 18 }}>
          <section className="converter">
            <div className="row" style={{ marginBottom: 14 }}>
              <span style={{ color: 'var(--lav)' }}><RefreshCw size={17} /></span>
              <h2 className="h2" style={{ fontSize: 16 }}>מחשבון המרה</h2>
            </div>

            <div className="cur-field">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                aria-label={`סכום ב-${from}`}
              />
              <select
                className="cur-select"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="מטבע מקור"
              >
                {SUPPORTED.map((c) => (
                  <option key={c} value={c}>{c} ({SYMBOL[c]})</option>
                ))}
              </select>
            </div>

            <div className="swap-row">
              <button className={`swap ${spin ? 'spin' : ''}`} onClick={swap} aria-label="החלף מטבעות">
                <ArrowUpDown size={16} />
              </button>
            </div>

            <div className="cur-field">
              <span className="cur-out" aria-live="polite">{fmt(converted)}</span>
              <select
                className="cur-select"
                value={to}
                onChange={(e) => { setTo(e.target.value); setTouched(true) }}
                aria-label="מטבע יעד"
              >
                {SUPPORTED.map((c) => (
                  <option key={c} value={c}>{c} ({SYMBOL[c]})</option>
                ))}
              </select>
            </div>

            {/* rate is null until the feed answers, and stays null if it
                never does — showing a stale number would be worse. */}
            <p className="tiny" style={{ marginTop: 12 }}>
              {rate != null ? (
                <>
                  שער יציג:{' '}
                  <span className="num">1 {from} = {rate.toFixed(3)} {to}</span>
                  {rates?.date && <> · עודכן <span className="num">{rates.date}</span></>}
                </>
              ) : ratesError ? (
                <span style={{ color: 'var(--amber)' }}>
                  שערי ההמרה לא נטענו. בדוק חיבור לאינטרנט.
                </span>
              ) : (
                'טוען שערים...'
              )}
            </p>

            {trip && !touched && (
              <div className="row" style={{ alignItems: 'flex-start', gap: 8, marginTop: 10 }}>
                <span style={{ color: localOk ? 'var(--muted)' : 'var(--amber)' }}>
                  <Info size={13} />
                </span>
                <span className="tiny">
                  {localOk ? (
                    <>
                      <strong className="ltr">{to}</strong> הוא המטבע ב{trip.city}.
                      אפשר לשנות אם צריך.
                    </>
                  ) : (
                    <>
                      המטבע המקומי ב{trip.city} הוא{' '}
                      <strong className="ltr">{local} ({SYMBOL[local] ?? local})</strong>,
                      אבל אין לו שער חי בשירות החינמי שבו האפליקציה משתמשת.
                      המחשבון כאן מציג <strong className="ltr">USD</strong> כברירת מחדל —
                      אפשר לבחור מטבע אחר.
                    </>
                  )}
                </span>
              </div>
            )}
          </section>
        </div>

        {/* ---- expense splitter ---- */}
        <div className="pad section-head">
          <div className="row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--lav)' }}><Users size={18} /></span>
            <h2 className="h2">מי שילם על מה</h2>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
          >
            הוסף הוצאה קבוצתית +
          </button>
        </div>

        <div className="pad">
          <div className="card">
            <div className="between" style={{ marginBottom: 14 }}>
              <span className="tiny">מצב החובות:</span>
              {/* Splitting per family charges each household once for all of
                  its members, instead of splitting head by head. */}
              <div className="split-toggle" role="group" aria-label="אופן החלוקה">
                <button className={splitBy === 'person' ? 'on' : ''} onClick={() => setSplitBy('person')}>
                  לפי אדם
                </button>
                <button className={splitBy === 'family' ? 'on' : ''} onClick={() => setSplitBy('family')}>
                  לפי משפחה
                </button>
              </div>
            </div>

            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                {parties.map((p) => (
                  <div key={p.id} className="member">
                    <span className="avatar" style={{ background: p.color }}>{p.short}</span>
                    <span className="col" style={{ gap: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</span>
                      {splitBy === 'family' && (
                        <span className="tiny"><span className="num">{p.size}</span> נוסעים</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              <div className="col" style={{ gap: 9, minWidth: 128 }}>
                <div className="balance owe">
                  אתה חייב <span className="num">{Math.round(owe)}₪</span>
                </div>
                <div className="balance owed">
                  חייבים לך <span className="num">{Math.round(owed)}₪</span>
                </div>
                <span className="tiny" style={{ textAlign: 'center' }}>
                  חלוקה שווה (<span className="num">{shares}</span>)
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="pad section-head">
          <h2 className="h2" style={{ fontSize: 16 }}>הוצאות אחרונות</h2>
        </div>

        <div className="pad" style={{ paddingBottom: 30 }}>
          <div className="card" style={{ paddingBlock: 4 }}>
            {expenses.length === 0 && (
              <p className="tiny" style={{ padding: 16, textAlign: 'center' }}>
                עדיין אין הוצאות רשומות
              </p>
            )}
            {expenses.map((e) => {
              const m = MEMBERS.find((x) => x.id === e.payer) ?? MEMBERS[0]
              return (
                <button
                  key={e.id}
                  className="expense-row"
                  style={{ width: '100%', textAlign: 'start' }}
                  onClick={() => openEdit(e)}
                  aria-label={`ערוך את ההוצאה ${e.title}`}
                >
                  <span className="avatar" style={{ background: m.color, width: 34, height: 34 }}>
                    {m.short}
                  </span>
                  <span className="grow col" style={{ gap: 2 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</strong>
                    <span className="tiny">
                      שילם/ה {m.name} · <span className="num">₪{Math.round(e.amount / shares)}</span> {splitBy === 'family' ? 'למשפחה' : 'לאדם'}
                    </span>
                  </span>
                  <strong className="num" style={{ fontSize: 14 }}>₪{e.amount}</strong>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <button className="fab" onClick={() => setAddOpen(true)}>
        <Receipt size={17} />
        הוסף הוצאה
      </button>

      <Sheet
        open={addOpen}
        title={editingId ? 'עריכת הוצאה' : 'הוצאה קבוצתית חדשה'}
        onClose={closeSheet}
      >
        <label className="label" htmlFor="exp-title">על מה שילמתם?</label>
        <input
          id="exp-title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="לדוגמה: ארוחת ערב ב-Le Comptoir"
        />

        <label className="label" htmlFor="exp-amount" style={{ marginTop: 16 }}>סכום (₪)</label>
        <input
          id="exp-amount"
          className="field num"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
          inputMode="decimal"
          placeholder="0.00"
        />

        <label className="label" style={{ marginTop: 16 }}>מי שילם?</label>
        <div className="pills" style={{ marginBottom: 22 }}>
          {MEMBERS.map((m) => (
            <button key={m.id} className={`pill ${payerId === m.id ? 'on' : ''}`} onClick={() => setPayer(m.id)}>
              {m.name}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 9 }}>
          {editingId && (
            <button className="btn btn-ghost" onClick={removeExpense} aria-label="מחק הוצאה">
              <X size={17} />
            </button>
          )}
          <button className="btn btn-primary btn-block grow" onClick={saveExpense}>
            {saved
              ? <><Check size={17} /> נשמר</>
              : editingId
                ? <><Check size={17} /> שמור שינויים</>
                : <><Plus size={17} /> הוסף הוצאה</>}
          </button>
        </div>
        <p className="tiny" style={{ textAlign: 'center', marginTop: 12 }}>
          ההוצאה תתחלק שווה בשווה בין <span className="num">{shares}</span> {splitBy === 'family' ? 'המשפחות' : 'חברי הקבוצה'}
        </p>
      </Sheet>
    </>
  )
}
