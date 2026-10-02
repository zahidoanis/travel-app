import { useTrip } from '../TripProvider'
import { X } from './Icons'
import { t } from '../i18n'

/**
 * One short message at the bottom of the screen, with at most one action.
 *
 * Its main job is undo: removing a stop, moving one to another day or
 * rebuilding a day shows what happened and offers to take it back, which
 * costs nothing when the change was intended — unlike a confirmation, which
 * interrupts every time. The message and what it can undo live together in
 * TripProvider (`snack`), so the offer disappears exactly when it stops
 * being valid.
 */
export default function Snack() {
  const { snack, runSnackAction, dismissSnack } = useTrip()
  if (!snack) return null

  return (
    <div className="snack" role="status">
      <span className="grow">{snack.text}</span>
      {snack.action && (
        <button className="snack-action" onClick={runSnackAction}>{snack.action}</button>
      )}
      <button className="snack-close" onClick={dismissSnack} aria-label={t('סגור')}>
        <X size={14} />
      </button>
    </div>
  )
}
