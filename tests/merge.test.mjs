import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeList } from '../src/lib/merge.js'

const ids = (list) => list.map((x) => x.id)

test('a family that joined while the editor was open is kept', () => {
  const base = [{ id: 'p1', n: 2 }, { id: 'p2', n: 1 }]
  const server = [...base, { id: 'p3', n: 4 }] // joined meanwhile
  const mine = [{ id: 'p1', n: 3 }, { id: 'p2', n: 1 }] // changed p1's headcount
  const out = mergeList(server, base, mine)
  assert.deepEqual(ids(out), ['p1', 'p2', 'p3'])
  assert.equal(out[0].n, 3)
})

test('only the fields changed here overwrite the server', () => {
  const base = [{ id: 'p1', n: 2, sharedDays: [] }]
  const server = [{ id: 'p1', n: 2, sharedDays: [3] }] // someone shared day 3
  const mine = [{ id: 'p1', n: 4, sharedDays: [] }] // changed headcount only
  assert.deepEqual(mergeList(server, base, mine), [{ id: 'p1', n: 4, sharedDays: [3] }])
})

test('an untouched item takes the server version', () => {
  const base = [{ id: 'a', t: '10:00' }]
  const server = [{ id: 'a', t: '11:00' }]
  assert.deepEqual(mergeList(server, base, base), server)
})

test('removing here removes; removed elsewhere stays removed unless changed here', () => {
  const base = [{ id: 'a' }, { id: 'b' }, { id: 'c', x: 1 }]
  const server = [{ id: 'a' }] // b and c removed elsewhere
  const mine = [{ id: 'b' }, { id: 'c', x: 2 }] // removed a, edited c
  assert.deepEqual(ids(mergeList(server, base, mine)), ['c'])
})

test('two people adding a stop to the same day both survive, in order', () => {
  const base = [{ id: 's1' }, { id: 's2' }]
  const server = [{ id: 's1' }, { id: 'theirs' }, { id: 's2' }]
  const mine = [{ id: 's1' }, { id: 's2' }, { id: 'mine' }]
  assert.deepEqual(ids(mergeList(server, base, mine)), ['s1', 'theirs', 's2', 'mine'])
})

test('a reorder here keeps its order', () => {
  const base = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(ids(mergeList(base, base, [{ id: 'c' }, { id: 'a' }, { id: 'b' }])), ['c', 'a', 'b'])
})

test('undo merges back what the change removed, without erasing others', () => {
  // A stop was removed (base -> current), then someone else added one.
  const current = [{ id: 'a' }]
  const server = [{ id: 'a' }, { id: 'new' }]
  const snapshot = [{ id: 'a' }, { id: 'removed' }] // undo wants this back
  assert.deepEqual(ids(mergeList(server, current, snapshot)).sort(), ['a', 'new', 'removed'])
})

test('a custom key, and empty or missing lists', () => {
  const byLabel = (s) => s.label
  assert.deepEqual(mergeList([], [], [{ label: 'H' }], byLabel), [{ label: 'H' }])
  assert.deepEqual(mergeList(undefined, undefined, undefined), [])
})
