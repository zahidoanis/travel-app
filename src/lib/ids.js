/**
 * An id for something several people can add to the same list at once —
 * an expense, a note, a stop, a family.
 *
 * These used to be `e${Date.now()}`. Two members saving within the same
 * millisecond got the same id, and since every list change de-duplicates by
 * id, the second one replaced the first: an expense gone, with no error
 * anywhere. The random tail makes a collision practically impossible.
 */
export function newId(prefix = '') {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 10)
    ?? Math.random().toString(36).slice(2, 12)
  return `${prefix}${Date.now().toString(36)}${random}`
}
