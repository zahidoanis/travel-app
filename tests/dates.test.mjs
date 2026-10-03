import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todayISO, nowHHMM, daysBetween, addDaysISO, normTime } from '../src/lib/dates.js'

test('todayISO is the local calendar date, not the date in Greenwich', () => {
  // 01:30 local on the 2nd. In any timezone east of Greenwich this instant
  // is still the 1st in UTC — which is what toISOString() would have said.
  const justAfterMidnight = new Date(2027, 2, 2, 1, 30)
  assert.equal(todayISO(justAfterMidnight), '2027-03-02')
  assert.equal(nowHHMM(justAfterMidnight), '01:30')
})

test('daysBetween counts calendar days across a daylight-saving change', () => {
  assert.equal(daysBetween('2027-03-24', '2027-03-27'), 3) // Israel springs forward on the 26th
  assert.equal(daysBetween('2027-03-27', '2027-03-24'), -3)
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1)
  assert.equal(daysBetween('2027-05-05', '2027-05-05'), 0)
})

test('addDaysISO lands on the right date whatever the timezone', () => {
  // The old local-setDate + toISOString mix returned 03-26 here in Israel.
  assert.equal(addDaysISO('2027-03-24', 3), '2027-03-27')
  assert.equal(addDaysISO('2027-02-27', 3), '2027-03-02')
  assert.equal(addDaysISO('2027-01-01', -1), '2026-12-31')
})

test('normTime reads the times a model or a person writes', () => {
  assert.equal(normTime('9:5'), '09:05')
  assert.equal(normTime('9.30'), '09:30')
  assert.equal(normTime('9'), '09:00')
  assert.equal(normTime(' 14:00 '), '14:00')
  assert.equal(normTime('25:00'), null)
  assert.equal(normTime('שעה'), null)
  assert.equal(normTime(undefined), null)
})
