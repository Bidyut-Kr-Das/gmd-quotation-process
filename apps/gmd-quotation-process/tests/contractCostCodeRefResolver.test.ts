import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planContractCostCodeRefs,
  indentCostRefKey,
  type ContractCostRefSource,
  type IndentRmCodeRow,
} from '../lib/contractCostCodeRefResolver.js'

function contract(overrides: Partial<ContractCostRefSource> = {}): ContractCostRefSource {
  return {
    id: 'c1',
    item: 'SLV',
    size: '200MM',
    pnRating: 'PN-10/16',
    mcReceivedPending: 'RECEIVED',
    costCodeRef: null,
    ...overrides,
  }
}

function indent(overrides: Partial<IndentRmCodeRow> = {}): IndentRmCodeRow {
  return {
    id: 'i1',
    item: 'SLV',
    size: '200MM',
    pnRating: 'PN-10/16',
    mcReceivedPending: 'RECEIVED',
    rmCodeV1: 'RSD120003',
    rmCodeV2: 'RSD120004',
    rmCodeV3: 'RSD120005',
    rmCodeV4: 'RSD120006',
    ...overrides,
  }
}

test('a collapsed indent item and a full contract item name join together', () => {
  // The recompute collapses IndentListing.item to "SLV" and throws the variant
  // suffixes away, so the join has to go through parseItem on both sides.
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING 9523' })],
    [indent({ item: 'SLV' })],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'RSD120006' }])
})

test('an un-collapsed indent item name joins just as well', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING 9523' })],
    [indent({ item: 'SLV RISING 9523' })],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'RSD120006' }])
})

test('each variant slot takes its own RM code', () => {
  const cases: Array<[string, string]> = [
    ['SLV', 'RSD120003'],
    ['SLV 9523', 'RSD120004'],
    ['SLV RISING', 'RSD120005'],
    ['SLV RISING 9523', 'RSD120006'],
  ]
  for (const [item, expected] of cases) {
    const plan = planContractCostCodeRefs([contract({ item })], [indent()])
    assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: expected }], item)
  }
})

test('SLV METAL is a separate base item from SLV', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV METAL RISING' })],
    [indent({ item: 'SLV METAL', rmCodeV3: 'MTM300001' })],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'MTM300001' }])
})

test('TPAV+SLV is resolved as its own compound base item', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'TPAV+RISING SLV' })],
    [indent({ item: 'TPAV+SLV' })],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'RSD120005' }])
})

test('size unit suffixes and PN rating buckets are normalised on both sides', () => {
  const plan = planContractCostCodeRefs(
    [contract({ size: '200', pnRating: 'PN-16' })],
    [indent({ size: '200MM', pnRating: 'PN-10/16' })],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'RSD120003' }])
})

test('the join key ignores the variant suffixes and the unit suffix', () => {
  assert.equal(
    indentCostRefKey({ item: 'SLV RISING 9523', size: '200MM', pnRating: 'PN-16' }),
    indentCostRefKey({ item: 'SLV', size: '200', pnRating: 'PN-10/16' }),
  )
})

test('a different size or PN rating does not match', () => {
  const plan = planContractCostCodeRefs(
    [contract({ size: '300MM' })],
    [indent()],
  )
  assert.equal(plan.skippedNoIndent, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: null }])
})

test('a received/pending pair resolves to the row with a matching MC status', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING', mcReceivedPending: 'PENDING' })],
    [
      indent({ id: 'rec', mcReceivedPending: 'RECEIVED', rmCodeV3: 'RECV003' }),
      indent({ id: 'pen', mcReceivedPending: 'PENDING', rmCodeV3: 'PEND003' }),
    ],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'PEND003' }])
})

test('a single indent row is used regardless of MC status', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING', mcReceivedPending: 'PENDING' })],
    [indent({ mcReceivedPending: 'RECEIVED' })],
  )
  assert.equal(plan.resolved, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: 'RSD120005' }])
})

test('an ambiguous received/pending pair is not guessed at', () => {
  // Handing a rising-stem code to a plain contract is worse than leaving it
  // blank, so neither row is used.
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV', mcReceivedPending: 'ON HOLD' })],
    [
      indent({ id: 'rec', mcReceivedPending: 'RECEIVED' }),
      indent({ id: 'pen', mcReceivedPending: 'PENDING' }),
    ],
  )
  assert.equal(plan.skippedNoIndent, 1)
  assert.equal(plan.resolved, 0)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: null }])
})

test('a slot with no RM code is cleared and counted as unmatched', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING', costCodeRef: 'STALE' })],
    [indent({ rmCodeV3: '' })],
  )
  assert.equal(plan.unmatched, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: null }])
})

test('a slot with no balance has no RM code even when the raw material exists', () => {
  // planIndentRmCodes leaves a code blank for an empty V column, so an empty
  // V3 must not fall back to another slot's code.
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING' })],
    [indent({ rmCodeV3: '   ' })],
  )
  assert.equal(plan.unmatched, 1)
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: null }])
})

test('a multi-code slot passes through as CSV and counts as ambiguous', () => {
  const plan = planContractCostCodeRefs(
    [contract({ item: 'SLV RISING' })],
    [indent({ rmCodeV3: 'RSD120005, RSD120007' })],
  )
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.resolved, 0)
  assert.deepEqual(plan.updates, [
    { id: 'c1', costCodeRef: 'RSD120005, RSD120007' },
  ])
})

test('an unparseable item is skipped with no update emitted', () => {
  const plan = planContractCostCodeRefs(
    [
      contract({ id: 'blank', item: null }),
      contract({ id: 'spaces', item: '   ' }),
      contract({ id: 'unknown', item: 'KGV' }),
    ],
    [indent()],
  )
  assert.equal(plan.skippedNoItem, 3)
  assert.deepEqual(plan.updates, [])
})

test('several contract rows resolve independently from one indent row', () => {
  const plan = planContractCostCodeRefs(
    [
      contract({ id: 'a', item: 'SLV' }),
      contract({ id: 'b', item: 'SLV RISING 9523' }),
      contract({ id: 'c', item: 'SLV', size: '300MM' }),
    ],
    [indent()],
  )
  assert.equal(plan.resolved, 2)
  assert.equal(plan.skippedNoIndent, 1)
  assert.deepEqual(plan.updates, [
    { id: 'a', costCodeRef: 'RSD120003' },
    { id: 'b', costCodeRef: 'RSD120006' },
    { id: 'c', costCodeRef: null },
  ])
})

test('every populated slot is always emitted so the field self-corrects', () => {
  // A stale code from an earlier run must be cleared when the indent row no
  // longer resolves, which only works if the update is always produced.
  const plan = planContractCostCodeRefs(
    [contract({ item: 'BFV', costCodeRef: 'OLD' })],
    [indent()],
  )
  assert.deepEqual(plan.updates, [{ id: 'c1', costCodeRef: null }])
})
