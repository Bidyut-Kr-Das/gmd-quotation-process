import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesGlobalSearch } from '../lib/filterUtils.js'
import type { EnquiryData } from '../lib/types.js'

// The dashboard search used to run as a Prisma `where` clause:
//   docketNumber contains OR partyName contains OR items.some(itemName contains), insensitive.
// It now runs client-side through matchesGlobalSearch. These assertions pin that parity.

const enquiry = {
  id: 'e1',
  docketNumber: 'GMD/2025-26/12',
  partyName: 'Reliance Infra Ltd',
  items: [{ itemName: 'Butterfly Valve DN200' }, { itemName: 'Gate Valve 150mm' }],
} as unknown as EnquiryData

test('empty query matches everything', () => {
  assert.equal(matchesGlobalSearch(enquiry, ''), true)
  assert.equal(matchesGlobalSearch(enquiry, '   '), true)
  assert.equal(matchesGlobalSearch(enquiry, undefined), true)
})

test('matches on docket number, case-insensitively', () => {
  assert.equal(matchesGlobalSearch(enquiry, 'gmd/2025'), true)
  assert.equal(matchesGlobalSearch(enquiry, '26/12'), true)
})

test('matches on party name, case-insensitively', () => {
  assert.equal(matchesGlobalSearch(enquiry, 'reliance'), true)
  assert.equal(matchesGlobalSearch(enquiry, 'INFRA'), true)
})

test('matches when any item name contains the query', () => {
  assert.equal(matchesGlobalSearch(enquiry, 'butterfly'), true)
  assert.equal(matchesGlobalSearch(enquiry, 'gate valve'), true)
})

test('does not match on fields the server query never searched', () => {
  assert.equal(matchesGlobalSearch(enquiry, 'nonexistent'), false)
  assert.equal(matchesGlobalSearch({ ...enquiry, state: 'Maharashtra' } as EnquiryData, 'maharashtra'), false)
})

test('surrounding whitespace in the query is ignored', () => {
  assert.equal(matchesGlobalSearch(enquiry, '  reliance  '), true)
})

test('an enquiry with no matching items still matches via docket or party', () => {
  const noItems = { ...enquiry, items: [] } as unknown as EnquiryData
  assert.equal(matchesGlobalSearch(noItems, 'reliance'), true)
  assert.equal(matchesGlobalSearch(noItems, 'butterfly'), false)
})
