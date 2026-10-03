import { createContext, useCallback, useContext, useState } from 'react'
import Sheet from './Sheet'
import { t } from '../i18n'

/**
 * "Are you sure?" for anything that cannot be taken back.
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: t('למחוק את ההוצאה?'), action: t('מחק') })) remove()
 *
 * Deleting an expense, a note, a reservation or a ticket photo used to be a
 * single tap on an X — the same X that closes a sheet, an inch away from it.
 * One shared sheet rather than a confirmation built into each screen, so
 * they all ask the same way.
 *
 * Changes to a day's stops do not come through here: those can be undone
 * (see `dayUndo` in TripProvider), which is kinder than asking every time.
 */
const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  // Asked one at a time, in order. A second question used to replace the
  // first on screen, and the first one's caller then waited forever — the
  // agent asking to rebuild a day while another confirm was open left its
  // reply stuck on "typing" for good.
  const [queue, setQueue] = useState([])
  const ask = queue[0] ?? null

  const confirm = useCallback(
    (options) => new Promise((resolve) => setQueue((q) => [...q, { ...options, resolve }])),
    []
  )

  // Answers the question that was on screen — a second tap landing after
  // the next question appeared must not answer that one too.
  const answer = (ok, which = ask) => {
    if (!which) return
    which.resolve(ok)
    setQueue((q) => q.filter((x) => x !== which))
  }

  return (
    <ConfirmContext.Provider value={{ confirm, ask, answer }}>
      {children}
    </ConfirmContext.Provider>
  )
}

/** Resolves true when the user confirms, false on cancel, Escape or scrim. */
export function useConfirm() {
  return useContext(ConfirmContext).confirm
}

/**
 * The sheet itself. Rendered once, last inside `.app`, so it sits above
 * whatever sheet asked the question.
 */
export function ConfirmHost() {
  const { ask, answer } = useContext(ConfirmContext)

  return (
    <Sheet open={ask !== null} title={ask?.title ?? ''} onClose={() => answer(false, ask)}>
      {ask?.body && <p className="sub" style={{ marginBottom: 20 }}>{ask.body}</p>}
      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-ghost btn-block grow" onClick={() => answer(false, ask)}>
          {t('ביטול')}
        </button>
        <button
          className={`btn btn-block grow ${ask?.danger === false ? 'btn-primary' : ''}`}
          style={ask?.danger === false ? undefined : { background: 'var(--rose)', color: '#fff' }}
          onClick={() => answer(true, ask)}
        >
          {ask?.action ?? t('מחק')}
        </button>
      </div>
    </Sheet>
  )
}
