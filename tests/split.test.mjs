import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAmount, divide, balances, settle, payerOf } from '../src/lib/split.js'

const fam = (id, size) => ({ id, members: Array.from({ length: size }, (_, i) => ({ id: `${id}-m${i}` })) })
const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0)

test('parseAmount reads both decimal marks and thousands separators', () => {
  assert.equal(parseAmount('12.5'), 12.5)
  assert.equal(parseAmount('12,50'), 12.5) // was read as 1250
  assert.equal(parseAmount('1,250'), 1250)
  assert.equal(parseAmount('1,250.50'), 1250.5)
  assert.equal(parseAmount(' ₪80 '), 80)
  assert.equal(parseAmount('0,5'), 0.5)
  assert.equal(parseAmount('10.999'), 11)
})

test('parseAmount rejects what is not an amount', () => {
  for (const bad of ['', 'abc', '0', '0.00', '1.2.3', '-5', null, undefined]) {
    assert.equal(parseAmount(bad), null, `"${bad}"`)
  }
})

test('divide hands out every agora exactly once', () => {
  assert.deepEqual(divide(10000, 3), [3334, 3333, 3333])
  assert.deepEqual(divide(100, 4), [25, 25, 25, 25])
  assert.deepEqual(divide(1, 3), [1, 0, 0])
  assert.deepEqual(divide(100, 0), [])
})

test('balances always sum to zero, including amounts that do not divide evenly', () => {
  const families = [fam('p1', 3), fam('p2', 2), fam('p3', 2)]
  const expenses = [
    { amount: 100, payer: 'p1-m0' },
    { amount: 33.33, payer: 'p2-m1' },
    { amount: 0.01, payer: 'p3-m0' },
    { amount: 999.99, payer: 'p1-m2' },
  ]
  for (const mode of ['person', 'family']) {
    const { byMember, byFamily } = balances(expenses, families, mode)
    assert.equal(sum(byFamily), 0, mode)
    if (mode === 'person') assert.equal(sum(byMember), 0)
  }
})

test('per person: a bigger family carries a bigger part of the bill', () => {
  const families = [fam('p1', 2), fam('p2', 4)]
  const { byFamily, byMember } = balances([{ amount: 600, payer: 'p1-m0' }], families, 'person')
  // 6 travellers, ₪100 each. p1 paid 600 and owes 200; p2 owes 400.
  assert.equal(byFamily.get('p1'), 40000)
  assert.equal(byFamily.get('p2'), -40000)
  assert.equal(byMember.get('p1-m0'), 50000)
  assert.equal(byMember.get('p1-m1'), -10000)
})

test('per family: each household pays one share whatever its size', () => {
  const families = [fam('p1', 2), fam('p2', 4)]
  const { byFamily } = balances([{ amount: 600, payer: 'p1-m0' }], families, 'family')
  assert.equal(byFamily.get('p1'), 30000)
  assert.equal(byFamily.get('p2'), -30000)
})

test('a family that joined later is not charged for earlier expenses', () => {
  const families = [fam('p1', 2), fam('p2', 2), fam('late', 2)]
  const expenses = [
    { amount: 400, payer: 'p1-m0', among: ['p1', 'p2'] }, // before `late` joined
    { amount: 600, payer: 'late-m0', among: ['p1', 'p2', 'late'] },
  ]
  const { byFamily } = balances(expenses, families, 'family')
  assert.equal(byFamily.get('late'), 40000) // paid 600, owes 200 — nothing from the first bill
  assert.equal(byFamily.get('p1'), 0) // paid 400, owes 200 + 200
  assert.equal(byFamily.get('p2'), -40000)
  assert.equal(sum(byFamily), 0)
})

test('an expense recorded for families that have all left falls back to everyone', () => {
  const families = [fam('p1', 1), fam('p2', 1)]
  const { byFamily } = balances([{ amount: 100, payer: 'p1-m0', among: ['gone'] }], families, 'family')
  assert.equal(byFamily.get('p1'), 5000)
  assert.equal(byFamily.get('p2'), -5000)
})

test('a payer whose seat was removed is still credited to their own family', () => {
  const families = [fam('p1', 2), fam('p2', 2)]
  // p2 used to have four members; the expense points at the fourth.
  assert.deepEqual(payerOf({ payer: 'p2-m3' }, families), { member: 'p2-m0', family: 'p2' })
  const { byFamily } = balances([{ amount: 400, payer: 'p2-m3' }], families, 'person')
  assert.equal(byFamily.get('p2'), 20000)
  assert.equal(byFamily.get('p1'), -20000)
})

test('an expense with no identifiable payer is left out rather than half-counted', () => {
  const families = [fam('p1', 2)]
  assert.equal(payerOf({ payer: 'ghost-m0' }, families), null)
  const { byFamily } = balances([{ amount: 100, payer: 'ghost-m0' }], families, 'person')
  assert.equal(byFamily.get('p1'), 0)
})

test('settle produces transfers that clear every balance', () => {
  const map = new Map([['a', 5000], ['b', -3000], ['c', -2000], ['d', 0]])
  const transfers = settle(map)
  assert.deepEqual(transfers, [
    { from: 'b', to: 'a', amount: 3000 },
    { from: 'c', to: 'a', amount: 2000 },
  ])
  const after = new Map(map)
  for (const t of transfers) {
    after.set(t.from, after.get(t.from) + t.amount)
    after.set(t.to, after.get(t.to) - t.amount)
  }
  assert.ok([...after.values()].every((v) => v === 0))
})

test('settle needs at most one transfer fewer than the people involved', () => {
  const families = [fam('p1', 1), fam('p2', 1), fam('p3', 1), fam('p4', 1)]
  const expenses = [
    { amount: 120, payer: 'p1-m0' },
    { amount: 45.5, payer: 'p2-m0' },
    { amount: 310, payer: 'p3-m0' },
  ]
  const { byFamily } = balances(expenses, families, 'family')
  assert.ok(settle(byFamily).length <= 3)
})
