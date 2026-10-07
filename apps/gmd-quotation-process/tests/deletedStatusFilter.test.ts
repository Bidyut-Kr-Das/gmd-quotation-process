import test from 'node:test'
import assert from 'node:assert/strict'
import {
  itemDeletedStatus,
  DELETED_CLOSED,
  DELETED_CURRENT_REQT,
  DELETED_STATUS_OPTIONS,
} from '../lib/filterUtils.js'

const closed = { cBatch: 'C', nBatch: null }
const notCurrent = { cBatch: null, nBatch: 'N' }
const both = { cBatch: 'C', nBatch: 'N' }
const normal = { cBatch: null, nBatch: null }

test('itemDeletedStatus passes everything when nothing is selected', () => {
  for (const item of [closed, notCurrent, both, normal]) {
    assert.equal(itemDeletedStatus(item, []), true)
    assert.equal(itemDeletedStatus(item, undefined), true)
  }
})

test('itemDeletedStatus filters by each deleted status', () => {
  assert.equal(itemDeletedStatus(closed, [DELETED_CLOSED]), true)
  assert.equal(itemDeletedStatus(notCurrent, [DELETED_CLOSED]), false)
  assert.equal(itemDeletedStatus(normal, [DELETED_CLOSED]), false)

  assert.equal(itemDeletedStatus(notCurrent, [DELETED_CURRENT_REQT]), true)
  assert.equal(itemDeletedStatus(closed, [DELETED_CURRENT_REQT]), false)
  assert.equal(itemDeletedStatus(normal, [DELETED_CURRENT_REQT]), false)
})

test('itemDeletedStatus ORs the two selected statuses', () => {
  const bothSelected = DELETED_STATUS_OPTIONS
  assert.equal(itemDeletedStatus(closed, bothSelected), true)
  assert.equal(itemDeletedStatus(notCurrent, bothSelected), true)
  assert.equal(itemDeletedStatus(both, bothSelected), true)
  assert.equal(itemDeletedStatus(normal, bothSelected), false)
})
