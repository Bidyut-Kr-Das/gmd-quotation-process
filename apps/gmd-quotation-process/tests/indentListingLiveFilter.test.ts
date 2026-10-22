import test from 'node:test'
import assert from 'node:assert/strict'
import {
  indentGroupKey,
  isLiveStatus,
  planLiveIndentGroups,
  planStaleIndentDeletes,
  type ContractReviewSourceRow,
} from '../lib/indentListingLiveFilter.js'

function row(overrides: Partial<ContractReviewSourceRow> = {}): ContractReviewSourceRow {
  return {
    item: 'SLV',
    size: '200',
    pnRating: 'PN - 16',
    mcReceivedPending: 'Pending',
    balBillAgCont: 10,
    status: null,
    ...overrides,
  }
}

test('blank STATUS is live', () => {
  assert.equal(isLiveStatus(null), true)
  assert.equal(isLiveStatus(undefined), true)
  assert.equal(isLiveStatus(''), true)
  assert.equal(isLiveStatus('   '), true)
})

test('any populated STATUS is not live', () => {
  for (const value of [
    'CLOSED',
    'closed',
    'COMPLETED',
    'TO BE CLOSED',
    'HOLD',
    'DUPLICATE',
    '-',
  ]) {
    assert.equal(isLiveStatus(value), false, `${value} should not be live`)
  }
})

test('rows with non-blank STATUS are excluded even when MC is received/pending', () => {
  const plan = planLiveIndentGroups([
    row({ status: 'CLOSED' }),
    row({ status: 'COMPLETED' }),
    row({ status: '' }),
  ])

  assert.equal(plan.included, 1)
  assert.equal(plan.skippedNonLive, 2)
  assert.equal(plan.groups.size, 1)
})

test('rows outside RECEIVED/PENDING are excluded even when STATUS is blank', () => {
  const plan = planLiveIndentGroups([
    row({ mcReceivedPending: null, status: null }),
    row({ mcReceivedPending: '', status: '' }),
    row({ mcReceivedPending: 'Received', status: null }),
    row({ mcReceivedPending: 'received', status: null }),
    row({ mcReceivedPending: 'Pending', status: null }),
  ])

  assert.equal(plan.included, 3)
  assert.equal(plan.skippedNotIndentable, 2)
  // 'Received' and 'received' collapse to one RECEIVED group, 'Pending' is its own
  assert.equal(plan.groups.size, 2)
})

test('a mixed group sums only the live rows', () => {
  const plan = planLiveIndentGroups([
    row({ status: null, balBillAgCont: 10 }),
    row({ status: 'CLOSED', balBillAgCont: 500 }),
    row({ status: 'COMPLETED', balBillAgCont: 700 }),
  ])

  const [group] = [...plan.groups.values()]
  assert.equal(group.sum, 10)
})

test('blank/non-numeric balances are treated as zero without poisoning the sum', () => {
  const plan = planLiveIndentGroups([
    row({ balBillAgCont: null, status: '' }),
    row({ balBillAgCont: '25', status: '' }),
    row({ balBillAgCont: '1,000', status: '' }),
  ])

  const [group] = [...plan.groups.values()]
  assert.equal(group.sum, 1025)
})

test('PN ratings still collapse into canonical buckets', () => {
  const plan = planLiveIndentGroups([
    row({ pnRating: 'PN - 10', balBillAgCont: 4, status: '' }),
    row({ pnRating: 'PN - 16', balBillAgCont: 6, status: '' }),
  ])

  assert.equal(plan.groups.size, 1)
  const [group] = [...plan.groups.values()]
  assert.equal(group.pnRating, 'PN-10/16')
  assert.equal(group.sum, 10)
})

test('item, size and MC status each split the groups', () => {
  const plan = planLiveIndentGroups([
    row({ item: 'SLV', mcReceivedPending: 'Received', status: '' }),
    row({ item: 'SLV', mcReceivedPending: 'Pending', status: '' }),
    row({ item: 'BFV', mcReceivedPending: 'Received', status: '' }),
    row({ item: 'SLV', size: '300', mcReceivedPending: 'Received', status: '' }),
  ])

  assert.equal(plan.groups.size, 4)
})

test('group key is stable across casing and whitespace', () => {
  assert.equal(
    indentGroupKey({ item: ' slv ', size: '200', pnRating: 'PN - 10', mcReceivedPending: 'received' }),
    indentGroupKey({ item: 'SLV', size: '200', pnRating: 'PN-16', mcReceivedPending: 'Received' }),
  )
})

test('planStaleIndentDeletes removes rows with no live source', () => {
  const liveKeys = [
    indentGroupKey({ item: 'SLV', size: '200', pnRating: 'PN-10/16', mcReceivedPending: 'Pending' }),
  ]
  const existing = [
    { id: 'keep', item: 'SLV', size: '200', pnRating: 'PN-10/16', mcReceivedPending: 'Pending' },
    { id: 'stale-1', item: 'SLV', size: '200', pnRating: 'PN-10/16', mcReceivedPending: 'Received' },
    { id: 'stale-2', item: 'BFV', size: '300', pnRating: null, mcReceivedPending: 'Pending' },
  ]

  assert.deepEqual(planStaleIndentDeletes(existing, liveKeys), ['stale-1', 'stale-2'])
})

test('planStaleIndentDeletes prunes everything when no live rows remain', () => {
  const existing = [
    { id: 'a', item: 'SLV', size: null, pnRating: null, mcReceivedPending: 'Pending' },
    { id: 'b', item: null, size: '200', pnRating: null, mcReceivedPending: 'Received' },
  ]

  assert.deepEqual(planStaleIndentDeletes(existing, []), ['a', 'b'])
})
