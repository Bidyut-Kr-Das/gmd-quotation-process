import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planQuotationIndentCostRefs,
  type QuotationCostRefItem,
  type QuotationIndentRmCodeRow,
} from '../lib/quotationIndentCostRefResolver.js'

function item(overrides: Partial<QuotationCostRefItem> = {}): QuotationCostRefItem {
  return {
    id: 'q1',
    itemName: 'SLV',
    size: '200MM',
    pnRating: 'PN-10/16',
    bomId: null,
    costRefCode: null,
    ...overrides,
  }
}

function indent(
  overrides: Partial<QuotationIndentRmCodeRow> = {},
): QuotationIndentRmCodeRow {
  return {
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

test('a no-BOM line takes the slot RM code from the indent listing', () => {
  const plan = planQuotationIndentCostRefs([item()], [indent()])
  assert.deepEqual(plan.fills, [{ id: 'q1', costRefCode: 'RSD120003' }])
  assert.equal(plan.filled, 1)
})

test('each variant slot takes its own RM code', () => {
  const cases: Array<[string, string]> = [
    ['SLV', 'RSD120003'],
    ['SLV 9523', 'RSD120004'],
    ['SLV RISING', 'RSD120005'],
    ['SLV RISING 9523', 'RSD120006'],
  ]
  for (const [itemName, expected] of cases) {
    const plan = planQuotationIndentCostRefs([item({ itemName })], [indent()])
    assert.equal(plan.fills[0]?.costRefCode, expected, itemName)
  }
})

test('a collapsed indent item and a full quotation item name join together', () => {
  // A completed recompute collapses IndentListing.item to "SLV"; the join has to
  // go through parseItem on the quotation side to recover the slot.
  const plan = planQuotationIndentCostRefs(
    [item({ itemName: 'SLV RISING 9523' })],
    [indent({ item: 'SLV' })],
  )
  assert.equal(plan.filled, 1)
  assert.deepEqual(plan.fills, [{ id: 'q1', costRefCode: 'RSD120006' }])
})

test('an un-collapsed indent item name joins just as well', () => {
  const plan = planQuotationIndentCostRefs(
    [item({ itemName: 'SLV RISING 9523' })],
    [indent({ item: 'SLV RISING 9523' })],
  )
  assert.equal(plan.filled, 1)
  assert.deepEqual(plan.fills, [{ id: 'q1', costRefCode: 'RSD120006' }])
})

test('size and PN rating are bucketed on both sides', () => {
  const plan = planQuotationIndentCostRefs(
    [item({ size: '200', pnRating: 'PN-10/16' })],
    [indent({ size: '200MM', pnRating: 'PN - 16' })],
  )
  assert.equal(plan.filled, 1)
  assert.equal(plan.fills[0].costRefCode, 'RSD120003')
})

test('a line with a BOM is never touched', () => {
  const plan = planQuotationIndentCostRefs([item({ bomId: 'BOM-1' })], [indent()])
  assert.equal(plan.fills.length, 0)
  assert.equal(plan.hasBom, 1)
  assert.equal(plan.filled, 0)
})

test('an existing cost ref is never overwritten', () => {
  const plan = planQuotationIndentCostRefs(
    [item({ costRefCode: 'MANUAL001' })],
    [indent()],
  )
  assert.equal(plan.fills.length, 0)
  assert.equal(plan.alreadySet, 1)
})

test('a line with no indent row for its key is counted as no match', () => {
  const plan = planQuotationIndentCostRefs(
    [item({ size: '999' })],
    [indent()],
  )
  assert.equal(plan.noMatch, 1)
  assert.equal(plan.fills.length, 0)
})

test('an empty variant slot is never filled', () => {
  const plan = planQuotationIndentCostRefs(
    [item({ itemName: 'SLV RISING' })],
    [indent({ rmCodeV3: '' })],
  )
  assert.equal(plan.unmatched, 1)
  assert.equal(plan.fills.length, 0)
})

test('a comma-joined slot is skipped as ambiguous', () => {
  const plan = planQuotationIndentCostRefs(
    [item()],
    [indent({ rmCodeV1: 'RSD110004, RSD110041' })],
  )
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.fills.length, 0)
})

test('a Received/Pending pair is skipped as ambiguous', () => {
  // MC Received/Pending is part of the indent primary key; a quotation line has
  // no MC status to choose between them, so no ref is written.
  const plan = planQuotationIndentCostRefs(
    [item()],
    [
      indent({ mcReceivedPending: 'RECEIVED' }),
      indent({ mcReceivedPending: 'PENDING' }),
    ],
  )
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.fills.length, 0)
})

test('an item name with no recognised base item is skipped', () => {
  const plan = planQuotationIndentCostRefs(
    [item({ itemName: 'GASKET SET' })],
    [indent()],
  )
  assert.equal(plan.skippedNoItem, 1)
  assert.equal(plan.fills.length, 0)
})

test('a blank item name is skipped', () => {
  const plan = planQuotationIndentCostRefs([item({ itemName: null })], [indent()])
  assert.equal(plan.skippedNoItem, 1)
})

test('every line lands in exactly one bucket', () => {
  const plan = planQuotationIndentCostRefs(
    [
      item({ id: 'filled' }),
      item({ id: 'bom', bomId: 'B' }),
      item({ id: 'set', costRefCode: 'X' }),
      item({ id: 'noitem', itemName: 'GASKET' }),
      item({ id: 'nomatch', size: '999' }),
      item({ id: 'ambig', itemName: 'SLV RISING' }), // V3 empty in indent below
    ],
    [indent({ rmCodeV3: '' })],
  )
  const total =
    plan.filled +
    plan.ambiguous +
    plan.unmatched +
    plan.noMatch +
    plan.skippedNoItem +
    plan.hasBom +
    plan.alreadySet
  assert.equal(total, 6)
})
