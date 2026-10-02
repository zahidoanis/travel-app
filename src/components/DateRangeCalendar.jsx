import { useState } from 'react'
import { ArrowLeft, ArrowRight } from './Icons'
import { todayISO } from '../lib/dates'
import { t, lang, locale } from '../i18n'

const WEEKDAYS = lang === 'he' ? ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // i18n-ignore

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

export default function DateRangeCalendar({ from, to, min, onChange }) {
  const seed = from || min || todayISO()
  const [view, setView] = useState(() => monthKey(seed))
  // Which grid is showing. Tapping the month or the year in the header
  // jumps straight there — a trip eight months out used to mean eight taps
  // on the arrow.
  const [mode, setMode] = useState('days') // days | months | years

  const { y: minY, m: minM } = monthKey(min || seed)
  const atFloor = view.y === minY && view.m === minM
  const monthBefore = (y, m) => Boolean(min) && (y < minY || (y === minY && m < minM))
  const firstYear = min ? minY : view.y - 2
  const years = Array.from({ length: 12 }, (_, i) => firstYear + i)

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
  const monthName = (m) => new Date(2000, m, 1).toLocaleDateString(locale, { month: 'long' })

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
          disabled={atFloor || mode !== 'days'}
          aria-label={t('חודש קודם')}
        >
          <ArrowRight size={16} />
        </button>
        <span className="cal-title">
          <button
            type="button"
            className={`cal-title-btn ${mode === 'months' ? 'on' : ''}`}
            onClick={() => setMode(mode === 'months' ? 'days' : 'months')}
            aria-label={t('בחר חודש')}
          >
            {monthName(view.m)}
          </button>
          <button
            type="button"
            className={`cal-title-btn num ${mode === 'years' ? 'on' : ''}`}
            onClick={() => setMode(mode === 'years' ? 'days' : 'years')}
            aria-label={t('בחר שנה')}
          >
            {view.y}
          </button>
        </span>
        <button type="button" className="icon-btn" onClick={nextMonth} disabled={mode !== 'days'} aria-label={t('חודש הבא')}>
          <ArrowLeft size={16} />
        </button>
      </div>

      {mode === 'months' && (
        <div className="cal-picker">
          {Array.from({ length: 12 }, (_, m) => (
            <button
              key={m}
              type="button"
              className={`cal-pick ${m === view.m ? 'on' : ''}`}
              disabled={monthBefore(view.y, m)}
              onClick={() => { setView({ y: view.y, m }); setMode('days') }}
            >
              {monthName(m)}
            </button>
          ))}
        </div>
      )}

      {mode === 'years' && (
        <div className="cal-picker">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={`cal-pick num ${y === view.y ? 'on' : ''}`}
              onClick={() => {
                // Keep the month, unless that month of this year is already
                // in the past — then the first month that isn't.
                setView({ y, m: monthBefore(y, view.m) ? minM : view.m })
                setMode('months')
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      {mode === 'days' && (<>
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
      </>)}
    </div>
  )
}
