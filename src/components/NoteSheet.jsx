import { useEffect, useState } from 'react'
import Sheet from './Sheet'
import { Check, X } from './Icons'
import { useConfirm } from './Confirm'
import { t } from '../i18n'

/**
 * Add or edit one note. Same sheet either way — `isNew` only changes the
 * title and whether a delete control shows up, matching the expense editor
 * this is modelled on.
 */
export default function NoteSheet({ open, isNew, initialText, onClose, onSave, onDelete }) {
  const [text, setText] = useState('')
  const confirm = useConfirm()

  const remove = async () => {
    if (await confirm({ title: t('למחוק את ההערה?') })) onDelete()
  }

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
    <Sheet open={open} title={isNew ? t('הערה חדשה') : t('עריכת הערה')} onClose={onClose}>
      <textarea
        className="field"
        // Grows with what is written, up to a point, instead of a fixed
        // three lines with a scrollbar inside a sheet that itself scrolls.
        rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
        maxLength={1000}
        style={{ resize: 'vertical', lineHeight: 1.6 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('לדוגמה: הנהג ממתין ליד יציאה 3, טלפון 050-1234567')}
        autoFocus
      />
      <div className="row" style={{ gap: 9, marginTop: 16 }}>
        {!isNew && (
          <button className="btn btn-ghost" onClick={remove} aria-label={t('מחק הערה')}>
            <X size={17} />
          </button>
        )}
        <button className="btn btn-primary btn-block grow" onClick={save} disabled={!text.trim()}>
          <Check size={17} />
          {t('שמור')}
        </button>
      </div>
    </Sheet>
  )
}
