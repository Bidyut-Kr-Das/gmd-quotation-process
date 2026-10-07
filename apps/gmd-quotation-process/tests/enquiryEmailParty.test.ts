import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractEmailsFromValue,
  isExternalEmail,
  partyKey,
  buildPartyEmailIndex,
  resolveEmailsForParty,
} from '../lib/enquiryEmailParty.js'

test('extractEmailsFromValue handles the column shapes', () => {
  assert.deepEqual(extractEmailsFromValue('A B <a@x.com>'), ['a@x.com'])
  assert.deepEqual(extractEmailsFromValue({ value: 'a@x.com, B@Y.com' }), ['a@x.com', 'b@y.com'])
  assert.deepEqual(extractEmailsFromValue(['a@x.com', { value: 'b@y.com' }]), ['a@x.com', 'b@y.com'])
  assert.deepEqual(extractEmailsFromValue(null), [])
  assert.deepEqual(extractEmailsFromValue('no address here'), [])
})

test('isExternalEmail drops internal and spam addresses', () => {
  assert.equal(isExternalEmail('buyer@party.com'), true)
  assert.equal(isExternalEmail('puja.agarwal@laserpowerinfra.com'), false)
  assert.equal(isExternalEmail('info@gmdalui.co.in'), false)
  assert.equal(isExternalEmail('no-reply@tendertiger.com'), false)
})

test('partyKey normalizes case, spaces and punctuation', () => {
  assert.equal(partyKey('JSK INDUSTRIES PVT. LTD'), partyKey('jsk industries pvt ltd'))
  assert.equal(partyKey('A.DAMIANO & CO.'), 'ADAMIANOCO')
  assert.equal(partyKey(null), '')
})

test('buildPartyEmailIndex groups external emails by party and skips sentinels', () => {
  const idx = buildPartyEmailIndex([
    {
      subCategory: 'ACME VALVES PVT. LTD',
      sender: 'Buyer <buyer@acme.com>',
      toDetails: { value: 'sales@laserpowerinfra.com, buyer@acme.com' },
      ccDetails: null,
    },
    {
      subCategory: 'acme valves pvt ltd',
      sender: 'other@acme.co.in',
      toDetails: null,
      ccDetails: null,
    },
    { subCategory: 'OUTSIDER', sender: 'x@outside.com', toDetails: null, ccDetails: null },
    { subCategory: 'INTERNAL', sender: 'y@inside.com', toDetails: null, ccDetails: null },
    { subCategory: null, sender: 'z@null.com', toDetails: null, ccDetails: null },
  ])

  // Internal (laserpower) address is filtered out; the two case variants merge.
  assert.deepEqual(resolveEmailsForParty(idx, 'Acme Valves Pvt Ltd'), ['buyer@acme.com', 'other@acme.co.in'])
  assert.deepEqual(resolveEmailsForParty(idx, 'OUTSIDER'), [])
  assert.deepEqual(resolveEmailsForParty(idx, 'INTERNAL'), [])
  assert.equal(idx.size, 1)
})

test('resolveEmailsForParty returns empty for unknown or blank parties', () => {
  const idx = buildPartyEmailIndex([])
  assert.deepEqual(resolveEmailsForParty(idx, 'Nobody Ltd'), [])
  assert.deepEqual(resolveEmailsForParty(idx, null), [])
  assert.deepEqual(resolveEmailsForParty(idx, ''), [])
})
