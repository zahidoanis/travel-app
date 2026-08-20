import { useEffect } from 'react'
import { X } from './Icons'

/** Bottom sheet modal. Closes on Escape and on scrim click. */
export default function Sheet({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grabber" />
        <div className="between" style={{ marginBottom: 18 }}>
          <h2 className="h2">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">
            <X size={17} />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
