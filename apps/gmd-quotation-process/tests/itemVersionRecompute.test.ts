import test from 'node:test'
import assert from 'node:assert/strict'
import { planIndentRecompute } from '../lib/itemVersionResolver.js'

function row(overrides: Partial<Parameters<typeof planIndentRecompute>[0][number]> = {}) {
  return {
    id: 'r1',
    item: 'SLV',
    size: '200',
    pnRating: 'PN - 16',
    mcReceivedPending: 'Received',
    totalBalBillAgCont: 0,
    ...overrides,
  }
}

test('single plain row lands its balance in V1', () => {
  const { updates, deletes } = planIndentRecompute([row({ id: 'a', totalBalBillAgCont: 0 })])
  assert.equal(deletes.length, 0)
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], {
    id: 'a',
    item: 'SLV',
    pnRating: 'PN-10/16',
    totalBalBillAgCont: 0,
    v1: '0',
    v2: '',
    v3: '',
    v4: '',
    v1Category: 'Base',
    v2Category: '',
    v3Category: '',
    v4Category: '',
  })
})

test('merges colliding SLV-family rows, sums totals, splits balances per variant', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', totalBalBillAgCont: 10 }),
    row({ id: 'b', item: 'SLV-9523', totalBalBillAgCont: 5 }),
    row({ id: 'c', item: 'SLV RISING', totalBalBillAgCont: 2 }),
    row({ id: 'd', item: 'SLV-RISING-9523', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 3)
  assert.deepEqual([...deletes].sort(), ['b', 'c', 'd'])
  assert.equal(updates[0].id, 'a')
  assert.equal(updates[0].item, 'SLV')
  assert.equal(updates[0].totalBalBillAgCont, 20)
  assert.equal(updates[0].v1, '10')
  assert.equal(updates[0].v2, '5')
  assert.equal(updates[0].v3, '2')
  assert.equal(updates[0].v4, '3')
  assert.equal(updates[0].v1Category, 'Base')
  assert.equal(updates[0].v2Category, '9523')
  assert.equal(updates[0].v3Category, 'Rising')
  assert.equal(updates[0].v4Category, 'Rising 9523')
})

test('rows in the same slot are summed into that column', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'SLV-9523', totalBalBillAgCont: 5 }),
    row({ id: 'b', item: 'SLV 9523', totalBalBillAgCont: 7 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].v2, '12')
  assert.equal(updates[0].v1, '')
  assert.equal(updates[0].totalBalBillAgCont, 12)
})

test('DPCV maps DI->V1, CS->V2, 9523->V4 and leaves V3 blank', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'DPCV-DI', totalBalBillAgCont: 4 }),
    row({ id: 'b', item: 'DPCV-CS', totalBalBillAgCont: 6 }),
    row({ id: 'c', item: 'DPCV-9523', totalBalBillAgCont: 8 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].item, 'DPCV')
  assert.equal(updates[0].totalBalBillAgCont, 18)
  assert.equal(updates[0].v1, '4')
  assert.equal(updates[0].v2, '6')
  assert.equal(updates[0].v3, '')
  assert.equal(updates[0].v4, '8')
  assert.equal(updates[0].v1Category, 'DI')
  assert.equal(updates[0].v2Category, 'CS')
  assert.equal(updates[0].v3Category, '')
  assert.equal(updates[0].v4Category, '9523')
})

test('BFV maps plain/DI->V1, CS->V2, WAFER->V3, 9523->V4', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'BFV', totalBalBillAgCont: 1 }),
    row({ id: 'b', item: 'BFV-DI', totalBalBillAgCont: 2 }),
    row({ id: 'c', item: 'BFV CAST STEEL', totalBalBillAgCont: 5 }),
    row({ id: 'd', item: 'BFV-WAFER', totalBalBillAgCont: 3 }),
    row({ id: 'e', item: 'BFV-9523', totalBalBillAgCont: 4 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].item, 'BFV')
  assert.deepEqual(
    [updates[0].v1, updates[0].v2, updates[0].v3, updates[0].v4],
    ['3', '5', '3', '4'],
  )
  assert.deepEqual(
    [updates[0].v1Category, updates[0].v2Category, updates[0].v3Category, updates[0].v4Category],
    ['Base, DI', 'CS', 'Wafer', '9523'],
  )
  assert.equal(updates[0].totalBalBillAgCont, 15)
})

test('NRV unmapped suffix falls into the spare V2 slot', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'NRV-DI', totalBalBillAgCont: 1 }),
    row({ id: 'b', item: 'NRV-CS', totalBalBillAgCont: 2 }),
    row({ id: 'c', item: 'NRV-9523', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].item, 'NRV')
  assert.equal(updates[0].v1, '1')
  assert.equal(updates[0].v2, '2')
  assert.equal(updates[0].v3, '')
  assert.equal(updates[0].v4, '3')
  assert.equal(updates[0].v1Category, 'DI')
  assert.equal(updates[0].v2Category, 'CS')
  assert.equal(updates[0].v4Category, '9523')
})

test('multiple variants landing in the same slot join their categories', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'DPCV', totalBalBillAgCont: 3 }),
    row({ id: 'b', item: 'DPCV-DI', totalBalBillAgCont: 4 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(updates[0].v1, '7')
  assert.equal(updates[0].v1Category, 'Base, DI')
})

test('prefers a row whose item is exactly the base as survivor', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'first', item: 'SLV-9523' }),
    row({ id: 'exact', item: 'SLV' }),
  ])
  assert.equal(updates[0].id, 'exact')
  assert.deepEqual([...deletes], ['first'])
})

test('non-base items are left untouched', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'x', item: 'AIR CUSHION' }),
    row({ id: 'y', item: 'BALL FLOAT' }),
    row({ id: 'z', item: 'ZVV' }),
  ])
  assert.equal(updates.length, 0)
  assert.equal(deletes.length, 0)
})

test('blank item rows are untouched', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'x', item: '' }),
    row({ id: 'y', item: null }),
  ])
  assert.equal(updates.length, 0)
  assert.equal(deletes.length, 0)
})

test('case and whitespace in size/pn/status are normalized for grouping', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', size: ' 200 ', pnRating: 'PN - 16', mcReceivedPending: 'Received' }),
    row({ id: 'b', item: 'SLV-9523', size: '200', pnRating: '  PN - 10', mcReceivedPending: 'received' }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 1)
  assert.equal(updates[0].v2, '0')
  assert.equal(updates[0].pnRating, 'PN-10/16')
})


test('distinct base keys stay separate even with same size/pn/status', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV' }),
    row({ id: 'b', item: 'BFV' }),
  ])
  assert.equal(updates.length, 2)
  assert.equal(deletes.length, 0)
})

test('amounts are rounded to two decimals', () => {
  const { updates } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', totalBalBillAgCont: 1.2345 }),
  ])
  assert.equal(updates[0].v1, '1.23')
  assert.equal(updates[0].totalBalBillAgCont, 1.2345)
})

test('PN 10 and PN 16 merge into one PN-10/16 row', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', pnRating: 'PN - 10', totalBalBillAgCont: 4 }),
    row({ id: 'b', item: 'SLV', pnRating: 'PN - 16', totalBalBillAgCont: 6 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 1)
  assert.equal(updates[0].pnRating, 'PN-10/16')
  assert.equal(updates[0].totalBalBillAgCont, 10)
})

test('PN 20, 25 and 30 merge into one PN-20/25/30 row', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'BFV', pnRating: 'PN - 20', totalBalBillAgCont: 1 }),
    row({ id: 'b', item: 'BFV', pnRating: 'PN - 25', totalBalBillAgCont: 2 }),
    row({ id: 'c', item: 'BFV', pnRating: 'PN - 30', totalBalBillAgCont: 3 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 2)
  assert.equal(updates[0].pnRating, 'PN-20/25/30')
  assert.equal(updates[0].totalBalBillAgCont, 6)
})

test('CLASS-300# and PN-40 merge into one CLASS-300# row', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'DPCV', pnRating: 'CLASS-300#', totalBalBillAgCont: 7 }),
    row({ id: 'b', item: 'DPCV', pnRating: 'PN - 40', totalBalBillAgCont: 5 }),
  ])
  assert.equal(updates.length, 1)
  assert.equal(deletes.length, 1)
  assert.equal(updates[0].pnRating, 'CLASS-300#')
  assert.equal(updates[0].totalBalBillAgCont, 12)
})

test('unrelated PN buckets stay separate', () => {
  const { updates, deletes } = planIndentRecompute([
    row({ id: 'a', item: 'SLV', pnRating: 'PN - 16', totalBalBillAgCont: 4 }),
    row({ id: 'b', item: 'SLV', pnRating: 'CLASS-150#', totalBalBillAgCont: 6 }),
  ])
  assert.equal(updates.length, 2)
  assert.equal(deletes.length, 0)
  const buckets = updates.map((u) => u.pnRating).sort()
  assert.deepEqual(buckets, ['CLASS-150#', 'PN-10/16'])
})
