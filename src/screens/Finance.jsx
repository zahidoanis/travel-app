import { useMemo, useState } from 'react'
import TopBar from '../components/TopBar'
import Sheet from '../components/Sheet'
import {
  ArrowUpDown, RefreshCw, Users, Plus, Receipt, Check,
} from '../components/Icons'
import { RATES, CURRENCIES, MEMBERS, EXPENSES } from '../data'

const SYMBOL = { EUR: '€', USD: '$', CZK: 'Kč', THB: '฿', GBP: '£', AED: 'د.إ', CHF: 'Fr', ILS: '₪' }

const fmt = (n) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Finance() {
  /* ---- converter ---- */
  const [from, setFrom] = useState('EUR')
  const [to, setTo] = useState('ILS')
  const [amount, setAmount] = useState('100')
  const [spin, setSpin] = useState(false)

  // Everything is quoted against ILS, so cross-rates go through it.
  const rate = useMemo(() => RATES[from] / RATES[to], [from, to])
  const converted = useMemo(() => {
    const n = parseFloat(amount)
    return Number.isFinite(n) ? n * rate : 0
  }, [amount, rate])

  const swap = () => {
    setSpin((s) => !s)
    setFrom(to)
    setTo(from)
  }

  /* ---- expenses ---- */
  const [expenses, setExpenses] = useState(EXPENSES)
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [value, setValue] = useState('')
  const [payer, setPayer] = useState('u1')
  const [saved, setSaved] = useState(false)

  const total = expenses.reduce((sum, e) => sum + e.amount, 0)

  // Net position of "you" (u1): your share of everything, minus what you fronted.
  const { owe, owed } = useMemo(() => {
    let balance = 0
    for (const e of expenses) {
      const share = e.amount / e.split
      if (e.payer === 'u1') balance += e.amount - share
      else balance -= share
    }
    return { owe: balance < 0 ? Math.abs(balance) : 0, owed: balance > 0 ? balance : 0 }
  }, [expenses])

  const addExpense = () => {
    const n = parseFloat(value)
    if (!title.trim() || !Number.isFinite(n) || n <= 0) return
    setExpenses((list) => [
      { id: `e${Date.now()}`, title: title.trim(), payer, amount: n, split: MEMBERS.length - 1 },
      ...list,
    ])
    setTitle('')
    setValue('')
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      setAddOpen(false)
    }, 900)
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
                {CURRENCIES.map((c) => (
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
                onChange={(e) => setTo(e.target.value)}
                aria-label="מטבע יעד"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c} ({SYMBOL[c]})</option>
                ))}
              </select>
            </div>

            <p className="tiny" style={{ marginTop: 12 }}>
              שער יציג:{' '}
              <span className="num">1 {from} = {rate.toFixed(3)} {to}</span>
            </p>
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
            <span className="tiny" style={{ display: 'block', marginBottom: 12 }}>מצב החובות:</span>

            <div className="between" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                {MEMBERS.filter((m) => m.id !== 'u1').map((m) => (
                  <div key={m.id} className="member">
                    <span className="avatar" style={{ background: m.color }}>{m.short}</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</span>
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
                  חלוקה שווה (<span className="num">{MEMBERS.length - 1}</span>)
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
            {expenses.map((e) => {
              const m = MEMBERS.find((x) => x.id === e.payer) ?? MEMBERS[0]
              return (
                <div key={e.id} className="expense-row">
                  <span className="avatar" style={{ background: m.color, width: 34, height: 34 }}>
                    {m.short}
                  </span>
                  <span className="grow col" style={{ gap: 2 }}>
                    <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</strong>
                    <span className="tiny">
                      שילם/ה {m.name} · <span className="num">₪{Math.round(e.amount / e.split)}</span> לאדם
                    </span>
                  </span>
                  <strong className="num" style={{ fontSize: 14 }}>₪{e.amount}</strong>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <button className="fab" onClick={() => setAddOpen(true)}>
        <Receipt size={17} />
        הוסף הוצאה
      </button>

      <Sheet open={addOpen} title="הוצאה קבוצתית חדשה" onClose={() => setAddOpen(false)}>
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
            <button key={m.id} className={`pill ${payer === m.id ? 'on' : ''}`} onClick={() => setPayer(m.id)}>
              {m.name}
            </button>
          ))}
        </div>

        <button className="btn btn-primary btn-block" onClick={addExpense}>
          {saved ? <><Check size={17} /> נשמר</> : <><Plus size={17} /> הוסף הוצאה</>}
        </button>
        <p className="tiny" style={{ textAlign: 'center', marginTop: 12 }}>
          ההוצאה תתחלק שווה בשווה בין <span className="num">{MEMBERS.length - 1}</span> חברי הקבוצה
        </p>
      </Sheet>
    </>
  )
}
