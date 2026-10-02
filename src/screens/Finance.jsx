import { useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import {
  ArrowUpDown, RefreshCw, Users, Plus, Receipt, Check, Info, X,
} from '../components/Icons'
import { useTrip } from '../TripProvider'
import { SUPPORTED, SYMBOL, localCurrency, fetchRates, isConvertible } from '../lib/currency'
import { balances, settle, payerOf, parseAmount, fromAgorot, toAgorot } from '../lib/split'
import { useConfirm } from '../components/Confirm'
import { newId } from '../lib/ids'
import { t, tn } from '../i18n'

const fmt = (n) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Shekels for display: whole amounts without ".00", the rest to the agora. */
const money = (n) =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })

/** A rate of 0.00027 printed to three places is "0.000". */
const rateText = (r) => (r >= 0.01 ? r.toFixed(3) : r.toPrecision(3))

export default function Finance() {
  const {
    families: FAMILIES, trip, myFamily,
    addExpense, updateExpense, removeExpense: removeExpenseFromTrip,
  } = useTrip()
  const confirm = useConfirm()
  // Every traveller is a member of exactly one party.
  // Onboarding no longer collects individual names — a member is just a
  // headcount now — so the payer picker needs something to show besides a
  // blank pill. Numbered within the family ("כהן 2") stays distinguishable
  // without asking anyone to type a name; a real one (an older trip, or
  // someone who typed one anyway) still wins over the fallback.
  const MEMBERS = FAMILIES.flatMap((f) =>
    f.members.map((m, i) => ({
      id: m.id,
      // A family nobody named (a solo trip is never asked for one) used to
      // come out as " 1", " 2".
      name: m.name.trim() || `${f.name.trim() || t('נוסע')} ${i + 1}`,
      short: m.name.trim().charAt(0) || f.short,
      color: f.color,
      family: f.id,
    }))
  )
  // Who is holding this device. It used to be "the first member of the
  // first party" — the trip's creator — for everyone, so a family that
  // joined by link was shown the creator's debt under "you owe".
  const mine = FAMILIES.find((f) => f.id === myFamily) ?? FAMILIES[0] ?? null
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
    const toRate = rates.rates[to]
    // rates are per 1 ILS, so ILS-per-unit is the reciprocal.
    return f && toRate ? toRate / f : null
  }, [rates, from, to])

  const converted = useMemo(() => {
    const n = parseAmount(amount)
    return n != null && rate != null ? n * rate : 0
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

  const total = fromAgorot(expenses.reduce((sum, e) => sum + toAgorot(e.amount), 0))

  /* ---- how the bill is divided ---- */
  const [splitBy, setSplitBy] = useState('person')

  // MEMBERS is derived, so the default payer has to wait for it.
  const payerId = payer ?? mine?.members[0]?.id ?? MEMBERS[0]?.id ?? null

  // Per person everyone pays an equal share; per family each household pays one
  // share regardless of size — the usual arrangement when families travel
  // together. All the arithmetic is in lib/split.js, in whole agorot.
  const { byMember, byFamily } = useMemo(
    () => balances(expenses, FAMILIES, splitBy),
    [expenses, FAMILIES, splitBy]
  )

  // Several families settle up between households — nobody needs to know
  // which of the Cohens owes which of the Levis. A single group of travellers
  // settles person to person.
  const households = FAMILIES.length > 1
  const units = households
    ? FAMILIES.map((f) => ({
        id: f.id,
        name: f.name.trim() || t('הנוסעים שלנו'),
        short: f.short,
        color: f.color,
        size: f.members.length,
        balance: byFamily.get(f.id) ?? 0,
        mine: f.id === mine?.id,
      }))
    : MEMBERS.map((m) => ({ ...m, size: 1, balance: byMember.get(m.id) ?? 0, mine: false }))

  const transfers = useMemo(
    () => settle(households ? byFamily : byMember),
    [households, byFamily, byMember]
  )
  const unitName = (id) => units.find((u) => u.id === id)?.name ?? ''

  // How many ways one bill is cut: travellers per person, households per family.
  const shares = splitBy === 'family' ? FAMILIES.length : MEMBERS.length
  const sharesOf = (e) => {
    const named = FAMILIES.filter((f) => e.among?.includes(f.id))
    const sharing = named.length > 0 ? named : FAMILIES
    return splitBy === 'family' ? sharing.length : sharing.reduce((n, f) => n + f.members.length, 0)
  }

  const myBalance = households && mine ? byFamily.get(mine.id) ?? 0 : 0

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

  const parsed = parseAmount(value)
  const canSave = Boolean(title.trim()) && parsed != null && payerId != null

  // Set synchronously, unlike `saved`: two taps inside one frame both run
  // before React re-renders, so state alone cannot stop the second one.
  const saving = useRef(false)

  const saveExpense = () => {
    // A second tap while the "saved" tick is on screen used to add the
    // expense again.
    if (!canSave || saving.current) return
    saving.current = true

    if (editingId) {
      updateExpense(editingId, { title: title.trim(), payer: payerId, amount: parsed })
    } else {
      addExpense({
        id: newId('e'),
        title: title.trim(),
        payer: payerId,
        amount: parsed,
        // Who was on the trip when this was spent — a family that joins
        // later is not charged for it.
        among: FAMILIES.map((f) => f.id),
      })
    }

    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      saving.current = false
      closeSheet()
    }, 900)
  }

  const removeExpense = async () => {
    const ok = await confirm({
      title: t('למחוק את ההוצאה?'),
      body: t('"{title}" תימחק עבור כל מי שבטיול.', { title }),
    })
    if (!ok) return
    removeExpenseFromTrip(editingId)
    closeSheet()
  }

  return (
    <>
      <div className="screen">
        <TopBar variant="brand" />

        <div className="pad between" style={{ alignItems: 'flex-start', marginTop: 6 }}>
          <div>
            <h1 className="h1" style={{ fontSize: 25 }}>{t('פיננסים')}</h1>
            <p className="tiny" style={{ marginTop: 4 }}>{t('מעקב הוצאות והמרת מטבע')}</p>
          </div>
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <span className="tiny">{t('סה"כ הוצאות')}</span>
            <strong style={{ fontSize: 20, fontWeight: 700 }}>
              <span className="num">₪{money(total)}</span>
            </strong>
          </div>
        </div>

        {/* ---- currency converter ---- */}
        <div className="pad" style={{ marginTop: 18 }}>
          <section className="converter">
            <div className="row" style={{ marginBottom: 14 }}>
              <span style={{ color: 'var(--lav)' }}><RefreshCw size={17} /></span>
              <h2 className="h2" style={{ fontSize: 16 }}>{t('מחשבון המרה')}</h2>
            </div>

            <div className="cur-field">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                inputMode="decimal"
                aria-label={t('סכום ב-{currency}', { currency: from })}
              />
              <select
                className="cur-select"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label={t('מטבע מקור')}
              >
                {SUPPORTED.map((c) => (
                  <option key={c} value={c}>{c} ({SYMBOL[c]})</option>
                ))}
              </select>
            </div>

            <div className="swap-row">
              <button className={`swap ${spin ? 'spin' : ''}`} onClick={swap} aria-label={t('החלף מטבעות')}>
                <ArrowUpDown size={16} />
              </button>
            </div>

            <div className="cur-field">
              <span className="cur-out" aria-live="polite">{fmt(converted)}</span>
              <select
                className="cur-select"
                value={to}
                onChange={(e) => { setTo(e.target.value); setTouched(true) }}
                aria-label={t('מטבע יעד')}
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
                  {t('שער יציג:')}{' '}
                  <span className="num">1 {from} = {rateText(rate)} {to}</span>
                  {rates?.date && <> · {t('עודכן')} <span className="num">{rates.date}</span></>}
                </>
              ) : ratesError ? (
                <span style={{ color: 'var(--amber)' }}>
                  {t('שערי ההמרה לא נטענו. בדוק חיבור לאינטרנט.')}
                </span>
              ) : (
                t('טוען שערים...')
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
                      <strong className="ltr">{to}</strong> {t('הוא המטבע ב{city}. אפשר לשנות אם צריך.', { city: trip.city })}
                    </>
                  ) : (
                    <>
                      {t('המטבע המקומי ב{city} הוא', { city: trip.city })}{' '}
                      <strong className="ltr">{local} ({SYMBOL[local] ?? local})</strong>,{' '}
                      {t('אבל אין לו שער חי בשירות החינמי שבו האפליקציה משתמשת.')}{' '}
                      {t('המחשבון כאן מציג')} <strong className="ltr">USD</strong> {t('כברירת מחדל — אפשר לבחור מטבע אחר.')}
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
            <h2 className="h2">{t('מי שילם על מה')}</h2>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--lav)' }}
          >
            {t('הוסף הוצאה קבוצתית +')}
          </button>
        </div>

        <div className="pad">
          <div className="card">
            <div className="between" style={{ marginBottom: 14 }}>
              <span className="tiny">{t('מצב החובות:')}</span>
              {/* Splitting per family charges each household once for all of
                  its members, instead of splitting head by head. */}
              <div className="split-toggle" role="group" aria-label={t('אופן החלוקה')}>
                <button className={splitBy === 'person' ? 'on' : ''} onClick={() => setSplitBy('person')}>
                  {t('לפי אדם')}
                </button>
                <button className={splitBy === 'family' ? 'on' : ''} onClick={() => setSplitBy('family')}>
                  {t('לפי משפחה')}
                </button>
              </div>
            </div>

            {/* Your own household's position, when there is more than one —
                the number most people open this screen for. */}
            {households && mine && (
              <div className={`balance ${myBalance < 0 ? 'owe' : 'owed'}`} style={{ marginBottom: 14 }}>
                {myBalance < 0
                  ? <>{t('אתם חייבים')} <span className="num">₪{money(fromAgorot(-myBalance))}</span></>
                  : myBalance > 0
                    ? <>{t('חייבים לכם')} <span className="num">₪{money(fromAgorot(myBalance))}</span></>
                    : t('אתם מאוזנים')}
              </div>
            )}

            {/* Everyone's position, not only the viewer's: who is in credit,
                who is in debt, and by how much. */}
            {units.map((u) => (
              <div key={u.id} className="member between">
                <span className="row" style={{ gap: 10, minWidth: 0 }}>
                  <span className="avatar" style={{ background: u.color }}>{u.short}</span>
                  <span className="col" style={{ gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                      {u.name}{u.mine ? ` ${t('(אתם)')}` : ''}
                    </span>
                    {households && (
                      <span className="tiny"><span className="num">{u.size}</span> {tn(u.size, 'נוסע', 'נוסעים')}</span>
                    )}
                  </span>
                </span>
                <span className={`unit-balance ${u.balance < 0 ? 'owe' : u.balance > 0 ? 'owed' : ''}`}>
                  {u.balance === 0
                    ? t('מאוזן')
                    : <>{u.balance < 0 ? t('חוב') : t('זכות')} <span className="num">₪{money(fromAgorot(Math.abs(u.balance)))}</span></>}
                </span>
              </div>
            ))}

            {transfers.length > 0 && (
              <div className="transfers">
                <span className="tiny">{t('כדי להתאזן:')}</span>
                {transfers.map((x) => (
                  <div key={`${x.from}-${x.to}`} className="transfer">
                    <span>{t('העברה מ{from} אל {to}', { from: unitName(x.from), to: unitName(x.to) })}</span>
                    <strong className="num">₪{money(fromAgorot(x.amount))}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="pad section-head">
          <h2 className="h2" style={{ fontSize: 16 }}>{t('הוצאות אחרונות')}</h2>
        </div>

        <div className="pad" style={{ paddingBottom: 30 }}>
          <div className="card" style={{ paddingBlock: 4 }}>
            {expenses.length === 0 && (
              <p className="tiny" style={{ padding: 16, textAlign: 'center' }}>
                {t('עדיין אין הוצאות רשומות')}
              </p>
            )}
            {expenses.map((e) => {
              // Resolved the same way the balances resolve it, so the name
              // on the row is always who the money was credited to.
              const who = payerOf(e, FAMILIES)
              const m = MEMBERS.find((x) => x.id === who?.member)
                ?? { name: t('מי שעזב את הטיול'), short: '?', color: 'var(--muted-2)' }
              return (
                <button
                  key={e.id}
                  className="expense-row"
                  style={{ width: '100%', textAlign: 'start' }}
                  onClick={() => openEdit(e)}
                  aria-label={t('ערוך את ההוצאה {title}', { title: e.title })}
                >
                  <span className="avatar" style={{ background: m.color, width: 34, height: 34 }}>
                    {m.short}
                  </span>
                  <span className="grow col" style={{ gap: 2 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</strong>
                    <span className="tiny">
                      {t('שילם/ה {name}', { name: m.name })} · <span className="num">₪{money(Math.round((e.amount / sharesOf(e)) * 100) / 100)}</span> {splitBy === 'family' ? t('למשפחה') : t('לאדם')}
                    </span>
                  </span>
                  <strong className="num" style={{ fontSize: 14 }}>₪{money(e.amount)}</strong>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <button className="fab" onClick={() => setAddOpen(true)}>
        <Receipt size={17} />
        {t('הוסף הוצאה')}
      </button>

      <Sheet
        open={addOpen}
        title={editingId ? t('עריכת הוצאה') : t('הוצאה קבוצתית חדשה')}
        onClose={closeSheet}
      >
        <label className="label" htmlFor="exp-title">{t('על מה שילמתם?')}</label>
        <input
          id="exp-title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('לדוגמה: ארוחת ערב ב-Le Comptoir')}
        />

        <label className="label" htmlFor="exp-amount" style={{ marginTop: 16 }}>{t('סכום (₪)')}</label>
        <input
          id="exp-amount"
          className="field num"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
          inputMode="decimal"
          placeholder="0.00"
          aria-invalid={value !== '' && parsed == null}
        />
        {value !== '' && parsed == null && (
          <p className="tiny" role="alert" style={{ color: 'var(--rose)', marginTop: 6 }}>
            {t('הסכום צריך להיות מספר גדול מאפס.')}
          </p>
        )}

        <label className="label" style={{ marginTop: 16 }}>{t('מי שילם?')}</label>
        <div className="pills" style={{ marginBottom: 22 }}>
          {MEMBERS.map((m) => (
            <button key={m.id} className={`pill ${payerId === m.id ? 'on' : ''}`} onClick={() => setPayer(m.id)}>
              {m.name}
            </button>
          ))}
        </div>

        <div className="row" style={{ gap: 9 }}>
          {editingId && (
            <button className="btn btn-ghost" onClick={removeExpense} aria-label={t('מחק הוצאה')}>
              <X size={17} />
            </button>
          )}
          <button className="btn btn-primary btn-block grow" onClick={saveExpense} disabled={!canSave || saved}>
            {saved
              ? <><Check size={17} /> {t('נשמר')}</>
              : editingId
                ? <><Check size={17} /> {t('שמור שינויים')}</>
                : <><Plus size={17} /> {t('הוסף הוצאה')}</>}
          </button>
        </div>
        <p className="tiny" style={{ textAlign: 'center', marginTop: 12 }}>
          {t('ההוצאה תתחלק שווה בשווה בין')} <span className="num">{shares}</span> {splitBy === 'family' ? t('המשפחות') : t('חברי הקבוצה')}
        </p>
      </Sheet>
    </>
  )
}
