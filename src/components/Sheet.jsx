import { useEffect, useRef, useState } from 'react'
import { X } from './Icons'
import { t } from '../i18n'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Open sheets, oldest first. A confirmation opens on top of the sheet that
// asked for it, and only the top one may answer the keyboard — otherwise one
// Escape closes both, and two focus traps fight over every Tab.
const stack = []

// How far the sheet has to be pulled down before letting go closes it.
const DISMISS_PX = 90

// Sheets that closed without Back still have their history entry to take
// off. Several can close in the same moment (picking from a menu that closes
// the sheet under it too) and in no particular order, and Chrome ignores a
// second history.back() issued before the first has finished. So closes are
// collected, and one history.go() goes back to just below the lowest sheet
// that closed.
const closing = new Set()
function takeOffHistory(depth) {
  closing.add(depth)
  if (closing.size > 1) return
  setTimeout(() => {
    const lowest = Math.min(...closing)
    closing.clear()
    const top = history.state?.sheet ?? 0
    if (top >= lowest) history.go(-(top - lowest + 1))
  }, 0)
}

/**
 * Bottom sheet modal. Closes on Escape, on scrim click, on the browser's
 * Back, and by dragging its top edge down.
 *
 * Keyboard focus moves into the sheet when it opens, stays inside it while
 * it is open, and goes back to whatever opened it when it closes — without
 * that, a keyboard or screen-reader user is left on a button underneath a
 * dialog they cannot reach.
 *
 * Back: in a native app the system back gesture closes what is on top; on
 * the web it goes to the previous page. On Android that meant swiping back
 * to dismiss a sheet left the whole screen instead. Each open sheet now adds
 * a history entry (marked with its depth), so Back closes the sheet and
 * nothing else; closing it any other way removes that entry again.
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
    const depth = stack.length

    // A field inside that asked for focus itself (autoFocus) keeps it.
    if (node && !node.contains(document.activeElement)) node.focus()

    history.pushState({ ...history.state, sheet: depth }, '')
    let poppedByBack = false
    const onPop = (e) => {
      if ((e.state?.sheet ?? 0) >= depth) return // still at (or above) this sheet's entry
      poppedByBack = true
      close.current()
    }
    window.addEventListener('popstate', onPop)

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
      window.removeEventListener('popstate', onPop)
      stack.splice(stack.indexOf(token), 1)
      // Closed by a button, Escape, the scrim or a drag: take this sheet's
      // history entry back off, so Back afterwards goes where it should.
      if (!poppedByBack) takeOffHistory(depth)
      if (opener?.isConnected) opener.focus?.()
    }
  }, [open])

  /* ---- drag the top edge down to close ---- */
  const [drag, setDrag] = useState(0)
  const start = useRef(null)
  const onPointerDown = (e) => {
    if (e.target.closest('button, a, input, select, textarea')) return
    start.current = e.clientY
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (start.current == null) return
    setDrag(Math.max(0, e.clientY - start.current))
  }
  const onPointerUp = () => {
    if (start.current == null) return
    start.current = null
    if (drag > DISMISS_PX) close.current()
    setDrag(0)
  }

  if (!open) return null

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className={`sheet ${drag ? 'dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
      >
        {/* The handle and title row are where a drag starts — not the body,
            which scrolls. */}
        <div
          className="sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="grabber" />
          <div className="between" style={{ marginBottom: 18 }}>
            <h2 className="h2">{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label={t('סגור')}>
              <X size={17} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </>
  )
}
