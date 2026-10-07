/** "יוסי כהן" -> "יכ". A single name falls back to its own first letter. */
export function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/** Lowercase, no accents, no punctuation — "Pastéis de Belém" ≈ "pasteis de belem". */
export const normName = (s = '') =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim()

/**
 * Same place by name? Word overlap measured against the LONGER name, so
 * "Castelo de São Jorge" ≈ "São Jorge Castle" (2 of 3) but "Prado" is not
 * "Jardim Eduardo Prado Coelho" (1 of 4) — both real cases.
 */
export function sameName(a, b) {
  if (normName(a) && normName(a) === normName(b)) return true
  const words = (s) => new Set(normName(s).split(' ').filter((w) => w.length > 2))
  const A = words(a)
  const B = words(b)
  if (A.size === 0 || B.size === 0) return false
  const shared = [...A].filter((w) => B.has(w)).length
  return shared / Math.max(A.size, B.size) >= 0.5
}
