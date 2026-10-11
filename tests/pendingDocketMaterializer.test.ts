import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isRealPartyName,
  threadExternalEmails,
  threadInternalEmails,
  threadPreferredEmails,
  threadSenderEmails,
  threadCcEmails,
  splitThreadEmails,
  buildEmailPartyMap,
  resolvePartyForThread,
  isDeletableDuplicate,
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

test('threadInternalEmails returns internal addresses only', () => {
  const emails = threadInternalEmails({
    subCategory: null,
    sender: 'Tridip <tridip@gmdalui.co.in>',
    toDetails: { value: 'buyer@acme.com, puja.agarwal@laserpowerinfra.com' },
    ccDetails: null,
  })
  assert.deepEqual(emails, ['tridip@gmdalui.co.in', 'puja.agarwal@laserpowerinfra.com'])
})

test('threadPreferredEmails uses external when present, internal when internal-only', () => {
  const external = threadPreferredEmails({
    subCategory: null,
    sender: 'buyer@acme.com',
    toDetails: { value: 'tridip@gmdalui.co.in' },
    ccDetails: null,
  })
  assert.deepEqual(external, ['buyer@acme.com'])

  const internalOnly = threadPreferredEmails({
    subCategory: null,
    sender: 'tridip@gmdalui.co.in',
    toDetails: { value: 'laserentry.four@gmail.com' },
    ccDetails: null,
  })
  assert.deepEqual(internalOnly, ['tridip@gmdalui.co.in', 'laserentry.four@gmail.com'])
})

test('threadSenderEmails takes the external sender', () => {
  assert.deepEqual(
    threadSenderEmails({ sender: 'Buyer <buyer@acme.com>', toDetails: { value: 'tridip@gmdalui.co.in' }, ccDetails: null }),
    ['buyer@acme.com'],
  )
})

test('threadSenderEmails falls back to to/cc when the sender is internal', () => {
  assert.deepEqual(
    threadSenderEmails({ sender: 'tridip@gmdalui.co.in', toDetails: { value: 'buyer@acme.com, other@acme.com' }, ccDetails: null }),
    ['buyer@acme.com', 'other@acme.com'],
  )
})

test('threadSenderEmails uses internal addresses only for an internal-only thread', () => {
  assert.deepEqual(
    threadSenderEmails({ sender: 'tridip@gmdalui.co.in', toDetails: { value: 'laserentry.four@gmail.com' }, ccDetails: null }),
    ['tridip@gmdalui.co.in', 'laserentry.four@gmail.com'],
  )
})

test('threadCcEmails returns external to/cc minus the sender', () => {
  assert.deepEqual(
    threadCcEmails({
      sender: 'buyer@acme.com',
      toDetails: { value: 'buyer@acme.com, accounts@acme.com' },
      ccDetails: { value: 'tridip@gmdalui.co.in, pm@acme.com' },
    }),
    ['accounts@acme.com', 'pm@acme.com'],
  )
})

test('splitThreadEmails picks one sender and puts the rest in cc', () => {
  assert.deepEqual(
    splitThreadEmails({
      sender: 'buyer@acme.com, boss@acme.com',
      toDetails: { value: 'tridip@gmdalui.co.in' },
      ccDetails: { value: 'accounts@acme.com' },
    }),
    { senderEmail: 'buyer@acme.com', ccEmails: ['boss@acme.com', 'accounts@acme.com'], source: 'thread' },
  )
})

test('splitThreadEmails falls back to to/cc when the sender is internal', () => {
  assert.deepEqual(
    splitThreadEmails({
      sender: 'tridip@gmdalui.co.in',
      toDetails: { value: 'buyer@acme.com, other@acme.com' },
      ccDetails: null,
    }),
    { senderEmail: 'buyer@acme.com', ccEmails: ['other@acme.com'], source: 'thread' },
  )
})

test('splitThreadEmails uses the party emails when the thread is internal-only', () => {
  assert.deepEqual(
    splitThreadEmails(
      { sender: 'tridip@gmdalui.co.in', toDetails: { value: 'laserentry.four@gmail.com' }, ccDetails: null },
      ['procurement@acme.com', 'accounts@acme.com'],
    ),
    { senderEmail: 'procurement@acme.com', ccEmails: ['accounts@acme.com'], source: 'party' },
  )
})

test('splitThreadEmails never returns internal addresses', () => {
  assert.deepEqual(
    splitThreadEmails({ sender: 'tridip@gmdalui.co.in', toDetails: { value: 'laserentry.four@gmail.com' }, ccDetails: null }),
    { senderEmail: null, ccEmails: [], source: 'none' },
  )
})

test('splitThreadEmails prefers the party when any source is internal', () => {
  assert.deepEqual(
    splitThreadEmails(
      { sender: 'buyer@acme.com', toDetails: { value: 'tridip@gmdalui.co.in' }, ccDetails: { value: 'pm@acme.com' } },
      ['party@acme.com', 'accounts@acme.com'],
    ),
    { senderEmail: 'party@acme.com', ccEmails: ['accounts@acme.com'], source: 'party' },
  )
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

test('isDeletableDuplicate requires Yes + a target + zero items', () => {
  assert.equal(isDeletableDuplicate({ duplicate: 'Yes', duplicateOfDocket: 'GMD/2026-27/1', itemCount: 0 }), true)
  assert.equal(isDeletableDuplicate({ duplicate: 'yes', duplicateOfDocket: 'GMD/2026-27/1', itemCount: 0 }), true)
  assert.equal(isDeletableDuplicate({ duplicate: 'No', duplicateOfDocket: 'GMD/2026-27/1', itemCount: 0 }), false)
  assert.equal(isDeletableDuplicate({ duplicate: 'Yes', duplicateOfDocket: '', itemCount: 0 }), false)
  assert.equal(isDeletableDuplicate({ duplicate: 'Yes', duplicateOfDocket: null, itemCount: 0 }), false)
  assert.equal(isDeletableDuplicate({ duplicate: 'Yes', duplicateOfDocket: 'GMD/2026-27/1', itemCount: 3 }), false)
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
