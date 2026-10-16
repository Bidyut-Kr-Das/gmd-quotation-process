import test from 'node:test'
import assert from 'node:assert/strict'
import { planIndentListingDedupe } from '../lib/indentListingDedupe.js'

function row(overrides: Partial<Parameters<typeof planIndentListingDedupe>[0][number]> = {}) {
  return {
    id: 'r1',
    item: 'SLV',
    size: '200',
    pnRating: 'PN - 16',
    mcReceivedPending: 'Pending',
    totalBalBillAgCont: 0,
    v1: null,
    v2: null,
    v3: null,
    v4: null,
    v1Category: null,
    v2Category: null,
    v3Category: null,
    v4Category: null,
    ...overrides,
  }
}

test('PN 10 and PN 16 merge into one canonical row', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: 'PN - 10', totalBalBillAgCont: 4 }),
    row({ id: 'b', pnRating: 'PN - 16', totalBalBillAgCont: 6 }),
  ])
  assert.equal(updates.length, 1)
  assert.deepEqual(deletes, ['b'])
  assert.equal(updates[0].pnRating, 'PN-10/16')
  assert.equal(updates[0].totalBalBillAgCont, 10)
})

test('PN 20, 25 and 30 merge into one canonical row', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', item: 'BFV', pnRating: 'PN - 20', totalBalBillAgCont: 1 }),
    row({ id: 'b', item: 'BFV', pnRating: 'PN - 25', totalBalBillAgCont: 2 }),
    row({ id: 'c', item: 'BFV', pnRating: 'PN - 30', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.deepEqual(deletes.sort(), ['b', 'c'])
  assert.equal(updates[0].pnRating, 'PN-20/25/30')
  assert.equal(updates[0].totalBalBillAgCont, 6)
})

test('CLASS-300# and PN 40 merge into one canonical row', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', item: 'DPCV', pnRating: 'CLASS-300#', totalBalBillAgCont: 7 }),
    row({ id: 'b', item: 'DPCV', pnRating: 'PN - 40', totalBalBillAgCont: 5 }),
  ])
  assert.equal(updates.length, 1)
  assert.deepEqual(deletes, ['b'])
  assert.equal(updates[0].pnRating, 'CLASS-300#')
  assert.equal(updates[0].totalBalBillAgCont, 12)
})

test('collision merges V columns and unions categories', () => {
  const { updates } = planIndentListingDedupe([
    row({ id: 'a', pnRating: 'PN - 10', v1: '1.5', v1Category: 'Base' }),
    row({ id: 'b', pnRating: 'PN - 16', v1: '2.25', v1Category: 'Rising', v2: '3', v2Category: '9523' }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].v1, '3.75')
  assert.equal(updates[0].v2, '3')
  assert.equal(updates[0].v1Category, 'Base, Rising')
  assert.equal(updates[0].v2Category, '9523')
})

test('non-colliding raw row is only canonicalized', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: 'PN - 10', totalBalBillAgCont: 4 }),
  ])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].pnRating, 'PN-10/16')
  assert.equal(updates[0].totalBalBillAgCont, 4)
})

test('non-base items are canonicalized and merged too', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', item: 'AIR CUSHION', pnRating: 'PN - 16', totalBalBillAgCont: 2 }),
    row({ id: 'b', item: 'AIR CUSHION', pnRating: 'PN - 10', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 1)
  assert.equal(updates[0].pnRating, 'PN-10/16')
  assert.equal(updates[0].totalBalBillAgCont, 5)
})

test('already-canonical singleton needs no update', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: 'PN-10/16' }),
  ])
  assert.equal(updates.length, 0)
  assert.equal(deletes.length, 0)
})

test('rows differing by size or status stay separate', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: 'PN - 10', size: '100' }),
    row({ id: 'b', pnRating: 'PN - 16', size: '200' }),
    row({ id: 'c', pnRating: 'PN - 10', mcReceivedPending: 'Received' }),
  ])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 3)
})

test('unrelated PN buckets stay separate', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: 'PN - 16' }),
    row({ id: 'b', pnRating: 'CLASS-150#' }),
  ])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 1)
  assert.deepEqual(
    updates.map((u) => u.pnRating),
    ['PN-10/16'],
  )
})

test('prefers an already-canonical row as survivor', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'raw', pnRating: 'PN - 10' }),
    row({ id: 'canon', pnRating: 'PN-10/16' }),
  ])
  assert.deepEqual(deletes, ['raw'])
  assert.equal(updates[0].id, 'canon')
})

test('a single blank rating is left untouched', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: null }),
  ])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 0)
})

test('duplicate blank rows collapse into one', () => {
  const { updates, deletes } = planIndentListingDedupe([
    row({ id: 'a', pnRating: null, totalBalBillAgCont: 2 }),
    row({ id: 'b', pnRating: '', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.deepEqual(deletes, ['b'])
  assert.equal(updates[0].pnRating, null)
  assert.equal(updates[0].totalBalBillAgCont, 5)
})
