import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planCostRefBackfill,
  type CostRefBackfillItem,
  type CostRefContractRow,
} from '../lib/contractReviewCostRefBackfill.js'

const OLD = new Date('2024-01-01T00:00:00Z')
const NEW = new Date('2025-06-01T00:00:00Z')

function item(overrides: Partial<CostRefBackfillItem> = {}): CostRefBackfillItem {
  return { id: 'i1', erpItemCode: 'RSD120003', costRefCode: null, ...overrides }
}

function contract(
  overrides: Partial<CostRefContractRow> = {},
): CostRefContractRow {
  return {
    itemCode: 'RSD120003',
    costCodeRef: 'RSD999001',
    dateOfContract: null,
    createdAt: OLD,
    syncedAt: OLD,
    ...overrides,
  }
}

test('a blank cost ref code is filled from the contract review row', () => {
  const plan = planCostRefBackfill([item()], [contract()])
  assert.equal(plan.filled, 1)
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'RSD999001' }])
})

test('an existing cost ref code is never overwritten', () => {
  // It is user-entered, and once set it drives the cost calculation through the
  // direct GMDUpdateItem match, so overwriting would silently reprice the line.
  const plan = planCostRefBackfill(
    [item({ costRefCode: 'MANUAL001' })],
    [contract()],
  )
  assert.equal(plan.alreadySet, 1)
  assert.equal(plan.filled, 0)
  assert.deepEqual(plan.fills, [])
})

test('a whitespace-only cost ref code counts as blank', () => {
  const plan = planCostRefBackfill([item({ costRefCode: '   ' })], [contract()])
  assert.equal(plan.filled, 1)
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'RSD999001' }])
})

test('item codes match across case and whitespace', () => {
  const plan = planCostRefBackfill(
    [item({ erpItemCode: '  rsd120003 ' })],
    [contract({ itemCode: 'RSD120003' })],
  )
  assert.equal(plan.filled, 1)
})

test('the newest contract date wins', () => {
  const plan = planCostRefBackfill(
    [item()],
    [
      contract({ costCodeRef: 'OLD001', dateOfContract: '12-Jan-24' }),
      contract({ costCodeRef: 'NEW001', dateOfContract: '05-Mar-25' }),
    ],
  )
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'NEW001' }])
})

test('DD-Mmm-YY contract dates are parsed, not handed to new Date()', () => {
  // new Date('12-Jan-26') is NaN in Node, so a naive tiebreak would never
  // resolve and would fall back to unordered query order.
  const plan = planCostRefBackfill(
    [item()],
    [
      contract({ costCodeRef: 'A', dateOfContract: '12-Jan-26' }),
      contract({ costCodeRef: 'B', dateOfContract: '11-Jan-26' }),
    ],
  )
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'A' }])
})

test('createdAt breaks the tie when dateOfContract is blank', () => {
  const plan = planCostRefBackfill(
    [item()],
    [
      contract({ costCodeRef: 'OLD', createdAt: OLD }),
      contract({ costCodeRef: 'NEW', createdAt: NEW }),
    ],
  )
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'NEW' }])
})

test('syncedAt breaks a tie when the contract date and creation match', () => {
  // Two contract rows for one code are often created in the same import, so the
  // last sync is the level that actually decides between them.
  const plan = planCostRefBackfill(
    [item()],
    [
      contract({ costCodeRef: 'STALE', syncedAt: OLD }),
      contract({ costCodeRef: 'FRESH', syncedAt: NEW }),
    ],
  )
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'FRESH' }])
})

test('a row equal on every recency signal keeps the incumbent', () => {
  // The two rows are indistinguishable here, so the incumbent stands rather
  // than letting query order decide which value lands in a cost cell.
  const first = contract({ costCodeRef: 'FIRST', dateOfContract: '12-Jan-26' })
  const second = contract({ costCodeRef: 'SECOND', dateOfContract: '12-Jan-26' })
  const plan = planCostRefBackfill([item()], [first, second])
  assert.equal(plan.filled, 1)
  assert.equal(plan.fills[0].costRefCode, 'FIRST')
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'FIRST' }])
})

test('an unparseable contract date loses to a dated row', () => {
  // A blank/garbage date must not be treated as infinitely recent.
  const plan = planCostRefBackfill(
    [item()],
    [
      contract({ costCodeRef: 'DATED', dateOfContract: '12-Jan-26' }),
      contract({ costCodeRef: 'UNDATED', dateOfContract: 'not a date' }),
    ],
  )
  assert.deepEqual(plan.fills, [{ id: 'i1', costRefCode: 'DATED' }])
})

test('a multi-code cost ref is skipped, not written', () => {
  // A comma-joined list can never be a GMDUpdateItem.erpItemCode, so writing it
  // would leave a cell that looks filled but never resolves a cost.
  const plan = planCostRefBackfill(
    [item()],
    [contract({ costCodeRef: 'RSD120005, RSD120007' })],
  )
  assert.equal(plan.multi, 1)
  assert.equal(plan.filled, 0)
  assert.deepEqual(plan.fills, [])
})

test('a blank source cost code ref is treated as no match', () => {
  for (const blank of [null, '', '   ']) {
    const plan = planCostRefBackfill([item()], [contract({ costCodeRef: blank })])
    assert.equal(plan.noMatch, 1, JSON.stringify(blank))
    assert.equal(plan.filled, 0)
  }
})

test('a code with no contract review row is reported as noMatch', () => {
  const plan = planCostRefBackfill([item()], [])
  assert.equal(plan.noMatch, 1)
  assert.deepEqual(plan.fills, [])
})

test('a blank item code can never match', () => {
  for (const code of [null, '   ']) {
    const plan = planCostRefBackfill(
      [item({ erpItemCode: code })],
      [contract()],
    )
    assert.equal(plan.noMatch, 1, JSON.stringify(code))
  }
})

test('a contract row with no item code is ignored', () => {
  const plan = planCostRefBackfill([item()], [contract({ itemCode: null })])
  assert.equal(plan.noMatch, 1)
})

test('each item resolves independently', () => {
  const plan = planCostRefBackfill(
    [
      item({ id: 'a', erpItemCode: 'RSD120003', costRefCode: null }),
      item({ id: 'b', erpItemCode: 'RSD120003', costRefCode: 'KEPT' }),
      item({ id: 'c', erpItemCode: 'RSD120004', costRefCode: null }),
      item({ id: 'd', erpItemCode: null, costRefCode: null }),
    ],
    [contract()],
  )
  assert.equal(plan.filled, 1)
  assert.equal(plan.alreadySet, 1)
  assert.equal(plan.noMatch, 2)
  assert.deepEqual(plan.fills, [{ id: 'a', costRefCode: 'RSD999001' }])
})

test('a multi-code row does not shadow a single-code row for the same item', () => {
  // The multi-code row is newer, so it wins the recency contest and the item is
  // then skipped as multi rather than falling back to the older usable code.
  const plan = planCostRefBackfill(
    [item()],
    [
      contract({ costCodeRef: 'GOOD001', dateOfContract: '12-Jan-24' }),
      contract({ costCodeRef: 'A, B', dateOfContract: '12-Jan-26' }),
    ],
  )
  assert.equal(plan.multi, 1)
  assert.deepEqual(plan.fills, [])
})
