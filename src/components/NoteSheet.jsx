import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { Check, X } from './Icons'

/**
 * Add or edit one note. Same sheet either way — `isNew` only changes the
 * title and whether a delete control shows up, matching the expense editor
 * this is modelled on.
 */
export default function NoteSheet({ open, isNew, initialText, onClose, onSave, onDelete }) {
  const [text, setText] = useState('')

  // Re-seed on every open rather than once on mount — the same sheet
  // instance is reused for every note, so a stale value from the last one
  // edited would otherwise flash before the effect below catches up.
  useEffect(() => {
    if (open) setText(initialText ?? '')
  }, [open, initialText])

  const save = () => {
    if (!text.trim()) return
    onSave(text)
  }

  return (
    <Sheet open={open} title={isNew ? 'הערה חדשה' : 'עריכת הערה'} onClose={onClose}>
      <textarea
        className="field"
        rows={3}
        style={{ resize: 'vertical', lineHeight: 1.6 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="לדוגמה: הנהג ממתין ליד יציאה 3, טלפון 050-1234567"
        autoFocus
      />
      <div className="row" style={{ gap: 9, marginTop: 16 }}>
        {!isNew && (
          <button className="btn btn-ghost" onClick={onDelete} aria-label="מחק הערה">
            <X size={17} />
          </button>
        )}
        <button className="btn btn-primary btn-block grow" onClick={save} disabled={!text.trim()}>
          <Check size={17} />
          שמור
        </button>
      </div>
    </Sheet>
  )
}
