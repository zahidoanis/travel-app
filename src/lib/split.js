/**
 * Splitting shared expenses: who paid, who owes, and who should pay whom.
 *
 * All arithmetic is in agorot (whole hundredths), never in floating-point
 * shekels. ₪100 between three people is 33.33 + 33.33 + 33.34 — the odd
 * agora has to land on someone, and with floats it lands nowhere: the
 * balances stop adding up to zero and the screen shows people owing ₪0.01
 * forever.
 *
 * No imports, so the tests can load it without a bundler.
 */

export const toAgorot = (amount) => Math.round(Number(amount) * 100)
export const fromAgorot = (agorot) => agorot / 100

/**
 * What someone typed, as a number of shekels — or null when it is not an
 * amount. Accepts a comma as the decimal mark ("12,50"), which the old
 * strip-everything-but-digits filter turned into 1250.
 *
 *   "12.5" -> 12.5     "12,50" -> 12.5     "1,250" -> 1250
 *   "1,250.50" -> 1250.5     "" / "abc" / "0" -> null
 */
export function parseAmount(text) {
  let s = String(text ?? '').trim().replace(/[\s₪]/g, '')
  if (!s || !/^[\d.,]+$/.test(s)) return null

  if (s.includes(',') && s.includes('.')) {
    // Both marks: the comma is grouping thousands.
    s = s.replace(/,/g, '')
  } else if (s.includes(',')) {
    // A comma alone is a decimal mark, unless it sits exactly three digits
    // from the end of a longer number — then it is "1,250".
    const tail = s.length - s.lastIndexOf(',') - 1
    s = tail === 3 && s.indexOf(',') === s.lastIndexOf(',') && s.indexOf(',') > 0
      ? s.replace(',', '')
      : s.replace(',', '.')
  }
  if ((s.match(/\./g) ?? []).length > 1) return null

  const n = Math.round(parseFloat(s) * 100) / 100
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Divides `total` agorot into `n` whole parts that sum back to `total`. */
export function divide(total, n) {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  const extra = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

/**
 * Net position of everyone on the trip, in agorot: what they paid minus
 * their share. Positive means they are owed money, negative means they owe.
 * The balances always sum to exactly zero.
 *
 * `families` is [{ id, members: [{ id }] }]. Each expense is
 * { amount, payer, among? }:
 *   - `payer` is a member id;
 *   - `among` is the family ids that were on the trip when the expense was
 *     recorded. A family that joins later is not charged for dinners it was
 *     not at. Missing (older expenses) means everyone.
 *
 * `mode` is how a bill is divided: 'person' gives every traveller an equal
 * share; 'family' gives every household one share whatever its size — the
 * usual arrangement when families travel together.
 */
export function balances(expenses, families, mode = 'person') {
  const byMember = new Map()
  const byFamily = new Map()
  for (const f of families) {
    byFamily.set(f.id, 0)
    for (const m of f.members) byMember.set(m.id, 0)
  }
  const bump = (map, id, delta) => map.set(id, (map.get(id) ?? 0) + delta)

  for (const e of expenses) {
    const amount = toAgorot(e.amount)
    if (!(amount > 0)) continue

    const named = (e.among ?? []).filter((id) => byFamily.has(id))
    const sharing = named.length > 0 ? families.filter((f) => named.includes(f.id)) : families
    const payer = payerOf(e, families)

    // Nobody to credit or nobody to charge: counting half of it would break
    // the one guarantee this function gives, that everything sums to zero.
    if (!payer || sharing.length === 0) continue

    if (mode === 'family') {
      divide(amount, sharing.length).forEach((share, i) => bump(byFamily, sharing[i].id, -share))
      bump(byFamily, payer.family, amount)
      continue
    }

    const heads = sharing.flatMap((f) => f.members.map((m) => ({ member: m.id, family: f.id })))
    if (heads.length === 0) continue
    divide(amount, heads.length).forEach((share, i) => {
      bump(byMember, heads[i].member, -share)
      bump(byFamily, heads[i].family, -share)
    })
    bump(byMember, payer.member, amount)
    bump(byFamily, payer.family, amount)
  }

  return { byMember, byFamily }
}

/**
 * Who paid, as { member, family } — or null when that cannot be worked out.
 *
 * Member ids are positional ("p1-m2"), so lowering a family's headcount can
 * leave an expense pointing at a member who no longer exists. The family is
 * still in the id, so the payment is credited to its first member rather
 * than silently handed to whoever happens to be first on the whole trip.
 */
export function payerOf(expense, families) {
  for (const f of families) {
    if (f.members.some((m) => m.id === expense.payer)) return { member: expense.payer, family: f.id }
  }
  const familyId = String(expense.payer ?? '').split('-m')[0]
  const family = families.find((f) => f.id === familyId)
  return family?.members.length ? { member: family.members[0].id, family: family.id } : null
}

/**
 * The fewest transfers that settle a set of balances: [{ from, to, amount }]
 * in agorot. Takes a Map of id -> balance (as returned by `balances`).
 * Greedy: the biggest debtor pays the biggest creditor until one of them is
 * square.
 */
export function settle(balanceMap) {
  const debtors = []
  const creditors = []
  for (const [id, value] of balanceMap) {
    if (value < 0) debtors.push({ id, left: -value })
    if (value > 0) creditors.push({ id, left: value })
  }
  const bySize = (a, b) => b.left - a.left
  debtors.sort(bySize)
  creditors.sort(bySize)

  const transfers = []
  let d = 0
  let c = 0
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].left, creditors[c].left)
    transfers.push({ from: debtors[d].id, to: creditors[c].id, amount })
    debtors[d].left -= amount
    creditors[c].left -= amount
    if (debtors[d].left === 0) d++
    if (creditors[c].left === 0) c++
  }
  return transfers
}
