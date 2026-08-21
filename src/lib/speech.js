import { useCallback, useEffect, useRef, useState } from 'react'
import { record, breadcrumb } from './telemetry'

/**
 * Hebrew dictation via the Web Speech API — built into the browser, free, no
 * key and no audio leaving the device beyond the browser's own recogniser.
 *
 * Support is uneven: Chrome and Edge implement it, Firefox does not, and iOS
 * Safari only from 14.5. `supported` lets the UI hide the button rather than
 * offer one that silently does nothing — which is what it did before.
 */
export function useSpeech({ lang = 'he-IL', onResult } = {}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const recRef = useRef(null)
  const onResultRef = useRef(onResult)

  onResultRef.current = onResult

  const Recognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : null

  const supported = Boolean(Recognition)

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped */
    }
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    if (!Recognition || listening) return
    setError(null)

    const rec = new Recognition()
    rec.lang = lang
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1

    rec.onresult = (event) => {
      let finalText = ''
      let partial = ''
      for (const result of event.results) {
        if (result.isFinal) finalText += result[0].transcript
        else partial += result[0].transcript
      }
      setInterim(partial)
      if (finalText) {
        setInterim('')
        onResultRef.current?.(finalText.trim())
      }
    }

    rec.onerror = (event) => {
      // "aborted" and "no-speech" are ordinary outcomes, not failures.
      if (event.error === 'aborted' || event.error === 'no-speech') {
        setListening(false)
        return
      }
      const message =
        event.error === 'not-allowed'
          ? 'הגישה למיקרופון נחסמה. אפשר אותה בהגדרות הדפדפן.'
          : event.error === 'network'
            ? 'זיהוי הדיבור דורש חיבור לאינטרנט.'
            : `זיהוי הדיבור נכשל (${event.error}).`

      setError(message)
      setListening(false)
      record({
        kind: 'speech',
        level: 'warn',
        message,
        context: { code: event.error, lang },
      })
    }

    rec.onend = () => {
      setListening(false)
      setInterim('')
    }

    try {
      rec.start()
      recRef.current = rec
      setListening(true)
      breadcrumb('action', 'dictation started')
    } catch (err) {
      setError('לא הצלחתי להפעיל את המיקרופון.')
      record({ kind: 'speech', message: err?.message ?? String(err) })
    }
  }, [Recognition, lang, listening])

  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop])

  // A recogniser left running after unmount keeps the mic indicator lit.
  useEffect(() => () => {
    try {
      recRef.current?.abort()
    } catch {
      /* nothing to abort */
    }
  }, [])

  return { supported, listening, interim, error, start, stop, toggle }
}
