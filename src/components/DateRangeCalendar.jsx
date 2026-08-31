import { useState } from 'react'
import { ArrowLeft, ArrowRight } from './Icons'

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const monthKey = (dateStr) => {
  const [y, m] = dateStr.split('-').map(Number)
  return { y, m: m - 1 }
}

/**
 * One month grid, tap a start day then an end day and the range between them
 * fills in — the single-screen range picker two separate native date inputs
 * never could be, since each of those only ever showed one date at a time.
 *
 * Controlled on `from`/`to` (plain "YYYY-MM-DD", same shape the rest of the
 * app already uses for trip dates) — this component only ever proposes a new
 * pair via onChange, it holds no date state of its own beyond which month is
 * currently in view.
 */
const todayISO = () => new Date().toISOString().slice(0, 10)

export default function DateRangeCalendar({ from, to, min, onChange }) {
  const seed = from || min || todayISO()
  const [view, setView] = useState(() => monthKey(seed))

  const { y: minY, m: minM } = monthKey(min || seed)
  const atFloor = view.y === minY && view.m === minM

  const prevMonth = () => {
    if (atFloor) return
    setView(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))
  }
  const nextMonth = () => setView(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))

  const pick = (day) => {
    if (!from || (from && to)) {
      onChange({ from: day, to: '' })
    } else if (day < from) {
      onChange({ from: day, to: from })
    } else {
      onChange({ from, to: day })
    }
  }

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const leading = new Date(view.y, view.m, 1).getDay()
  const today = todayISO()
  const label = new Date(view.y, view.m, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })

  const cells = [
    ...Array.from({ length: leading }, (_, i) => ({ empty: true, key: `e${i}` })),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const day = iso(view.y, view.m, i + 1)
      return { day, key: day }
    }),
  ]

  return (
    <div className="cal">
      <div className="cal-head">
        <button
          type="button"
          className="icon-btn"
          onClick={prevMonth}
          disabled={atFloor}
          aria-label="חודש קודם"
        >
          <ArrowRight size={16} />
        </button>
        <strong className="cal-title">{label}</strong>
        <button type="button" className="icon-btn" onClick={nextMonth} aria-label="חודש הבא">
          <ArrowLeft size={16} />
        </button>
      </div>

      <div className="cal-grid cal-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((c) => {
          if (c.empty) return <div key={c.key} className="cal-cell empty" />

          const disabled = min ? c.day < min : false
          const isStart = c.day === from
          const isEnd = c.day === to
          const inRange = from && to && c.day > from && c.day < to
          const isToday = c.day === today

          const cls = [
            'cal-cell',
            isStart && 'range-start',
            isEnd && 'range-end',
            (isStart || isEnd) && 'selected',
            inRange && 'in-range',
          ].filter(Boolean).join(' ')

          return (
            <button
              key={c.key}
              type="button"
              className={cls}
              disabled={disabled}
              onClick={() => pick(c.day)}
              aria-label={c.day}
              aria-pressed={isStart || isEnd}
            >
              <span className={`cal-num ${isToday && !isStart && !isEnd ? 'is-today' : ''}`}>
                {Number(c.day.slice(-2))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
