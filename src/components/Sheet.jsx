import { useEffect, useRef } from 'react'
import { X } from './Icons'
import { t } from '../i18n'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Open sheets, oldest first. A confirmation opens on top of the sheet that
// asked for it, and only the top one may answer the keyboard — otherwise one
// Escape closes both, and two focus traps fight over every Tab.
const stack = []

/**
 * Bottom sheet modal. Closes on Escape and on scrim click.
 *
 * Keyboard focus moves into the sheet when it opens, stays inside it while
 * it is open, and goes back to whatever opened it when it closes — without
 * that, a keyboard or screen-reader user is left on a button underneath a
 * dialog they cannot reach.
 */
export default function Sheet({ open, title, onClose, children }) {
  const panel = useRef(null)
  // Callers pass a fresh inline function every render; reading it through a
  // ref keeps the effect below from re-running (and re-focusing) each time.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return
    const node = panel.current
    const opener = document.activeElement
    const token = {}
    stack.push(token)

    // A field inside that asked for focus itself (autoFocus) keeps it.
    if (node && !node.contains(document.activeElement)) node.focus()

    const onKey = (e) => {
      if (stack[stack.length - 1] !== token) return
      // A sheet left open on a screen that is now hidden (screens stay
      // mounted between tabs) must not answer keys it cannot be seen for.
      if (node && node.getClientRects().length === 0) return
      if (e.key === 'Escape') {
        close.current()
        return
      }
      if (e.key !== 'Tab' || !node) return

      const items = [...node.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (!node.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(token), 1)
      if (opener?.isConnected) opener.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel}>
        <div className="grabber" />
        <div className="between" style={{ marginBottom: 18 }}>
          <h2 className="h2">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('סגור')}>
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
