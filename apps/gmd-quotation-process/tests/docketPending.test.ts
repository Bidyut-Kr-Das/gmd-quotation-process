import test from 'node:test'
import assert from 'node:assert/strict'
import { istDayWindow } from '../lib/docketPending.js'

const at = (iso: string) => new Date(iso)
const inside = (win: { start: Date; end: Date }, iso: string) => {
  const d = at(iso)
  return d >= win.start && d < win.end
}

test('istDayWindow opens at IST midnight, not UTC midnight', () => {
  // The container has no TZ set, so a UTC boundary would open at 05:30 IST.
  const win = istDayWindow(at('2026-10-15T10:00:00+05:30'))
  assert.equal(win.start.toISOString(), '2026-10-14T18:30:00.000Z')
  assert.equal(win.end.toISOString(), '2026-10-15T18:30:00.000Z')
})

test('a small-hours IST mail is inside today, though UTC still calls it yesterday', () => {
  // 02:00 IST on the 15th is 20:30Z on the 14th — the mail that a naive
  // UTC boundary would drop forever.
  const win = istDayWindow(at('2026-10-15T10:00:00+05:30'))
  const mail = at('2026-10-15T02:00:00+05:30')
  assert.equal(mail.toISOString(), '2026-10-14T20:30:00.000Z')
  assert.equal(inside(win, '2026-10-15T02:00:00+05:30'), true)
  assert.equal(mail >= at('2026-10-15T00:00:00.000Z'), false) // what UTC midnight would have done
})

test('the window covers the whole IST day and nothing either side', () => {
  const win = istDayWindow(at('2026-10-15T10:00:00+05:30'))
  assert.equal(inside(win, '2026-10-15T00:00:00+05:30'), true)
  assert.equal(inside(win, '2026-10-15T23:59:59+05:30'), true)
  assert.equal(inside(win, '2026-10-14T23:59:59+05:30'), false)
  assert.equal(inside(win, '2026-10-16T00:00:00+05:30'), false)
})

test('the window is the same instant whatever time of day it is asked', () => {
  const morning = istDayWindow(at('2026-10-15T06:00:00+05:30'))
  const night = istDayWindow(at('2026-10-15T23:30:00+05:30'))
  assert.equal(morning.start.toISOString(), night.start.toISOString())
  assert.equal(morning.end.toISOString(), night.end.toISOString())
})
