import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isRealPartyName,
  threadExternalEmails,
  buildEmailPartyMap,
  resolvePartyForThread,
} from '../lib/pendingDocketMaterializer.js'

test('isRealPartyName rejects blanks and sentinels', () => {
  assert.equal(isRealPartyName('ACME VALVES PVT LTD'), true)
  assert.equal(isRealPartyName('OUTSIDER'), false)
  assert.equal(isRealPartyName('internal'), false)
  assert.equal(isRealPartyName(''), false)
  assert.equal(isRealPartyName(null), false)
})

test('threadExternalEmails drops internal addresses and de-duplicates', () => {
  const emails = threadExternalEmails({
    subCategory: 'Acme',
    sender: 'Buyer <buyer@acme.com>',
    toDetails: { value: 'sales@laserpowerinfra.com, buyer@acme.com, info@acme.co.in' },
    ccDetails: null,
  })
  assert.deepEqual(emails, ['buyer@acme.com', 'info@acme.co.in'])
})

test('buildEmailPartyMap maps previous dockets and assigned threads', () => {
  const map = buildEmailPartyMap({
    enquiries: [
      { emailAddress: 'a@party.com, b@party.com', partyName: 'PARTY ONE' },
      { emailAddress: null, partyName: 'IGNORED' },
    ],
    assignedThreads: [
      {
        subCategory: 'PARTY TWO',
        sender: 'x@party2.com',
        toDetails: null,
        ccDetails: { value: 'y@party2.com' },
      },
      // sentinel sub_category must not contribute
      { subCategory: 'OUTSIDER', sender: 'o@outside.com', toDetails: null, ccDetails: null },
    ],
  })
  assert.equal(map.get('a@party.com'), 'PARTY ONE')
  assert.equal(map.get('b@party.com'), 'PARTY ONE')
  assert.equal(map.get('x@party2.com'), 'PARTY TWO')
  assert.equal(map.get('y@party2.com'), 'PARTY TWO')
  assert.equal(map.has('o@outside.com'), false)
})

test('resolvePartyForThread prefers an email match', () => {
  const map = new Map([['buyer@acme.com', 'ACME VALVES']])
  const r = resolvePartyForThread(
    { subCategory: 'SOME OTHER NAME', sender: 'b <buyer@acme.com>', toDetails: null, ccDetails: null },
    map,
  )
  assert.deepEqual(r, { partyName: 'ACME VALVES', source: 'email' })
})

test('resolvePartyForThread falls back to the thread partyName before subCategory', () => {
  const r = resolvePartyForThread(
    { subCategory: 'OUTSIDER', partyName: 'Acme Valves', sender: 'b@x.com', toDetails: null, ccDetails: null },
    new Map(),
  )
  assert.deepEqual(r, { partyName: 'Acme Valves', source: 'partyName' })
})

test('resolvePartyForThread falls back to a real subCategory', () => {
  const r = resolvePartyForThread(
    { subCategory: 'ACME VALVES', sender: 'b <buyer@unknown.com>', toDetails: null, ccDetails: null },
    new Map(),
  )
  assert.deepEqual(r, { partyName: 'ACME VALVES', source: 'subCategory' })
})

test('resolvePartyForThread falls back to Unknown for sentinels / no data', () => {
  assert.deepEqual(
    resolvePartyForThread({ subCategory: 'OUTSIDER', sender: 'b@x.com', toDetails: null, ccDetails: null }, new Map()),
    { partyName: 'Unknown', source: 'unknown' },
  )
  assert.deepEqual(
    resolvePartyForThread({ subCategory: null, sender: null, toDetails: null, ccDetails: null }, new Map()),
    { partyName: 'Unknown', source: 'unknown' },
  )
})
