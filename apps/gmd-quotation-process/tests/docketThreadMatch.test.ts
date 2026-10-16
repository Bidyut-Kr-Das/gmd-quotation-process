import test from 'node:test'
import assert from 'node:assert/strict'
import {
  docketLookupKeys,
  docketSerialToken,
  pickLatestLinkedThread,
  splitDocketList,
  type LinkedThreadCandidate,
} from '../lib/docketThreadMatch.js'

const DOCKET = 'GMD/2026-27/412'

function thread(overrides: Partial<LinkedThreadCandidate> = {}): LinkedThreadCandidate {
  return {
    threadId: 'thread-1',
    docketNo: DOCKET,
    date: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    msgCount: 1,
    subject: 'RFQ',
    ...overrides,
  }
}

test('docket keys align across the formats the sheet stores', () => {
  const canonical = new Set(docketLookupKeys(DOCKET))
  for (const variant of ['GMD/26-27/412', 'GMD2627412', 'GMD-26-27-412', '#GMD/2026-27/412']) {
    const keys = docketLookupKeys(variant)
    assert.ok(
      keys.some((k) => canonical.has(k)),
      `expected ${variant} to share a key with the canonical docket`,
    )
  }
})

test('docketSerialToken strips leading zeros', () => {
  assert.equal(docketSerialToken(DOCKET), '412')
  assert.equal(docketSerialToken('GMD/2026-27/0412'), '412')
  assert.equal(docketSerialToken('412'), '412')
  assert.equal(docketSerialToken('GMD'), '')
})

test('a bare-serial thread links to the formatted portal docket', () => {
  const bare = thread({ threadId: 'bare', docketNo: '412' })
  assert.equal(pickLatestLinkedThread([bare], DOCKET)?.threadId, 'bare')
})

test('splitDocketList breaks a multi-docket column', () => {
  assert.deepEqual(splitDocketList('GMD/26-27/412, GMD/26-27/413'), [
    'GMD/26-27/412',
    'GMD/26-27/413',
  ])
  assert.deepEqual(splitDocketList(null), [])
})

test('the latest linked thread wins', () => {
  const older = thread({
    threadId: 'old',
    date: new Date('2026-01-01T00:00:00Z'),
  })
  const newer = thread({
    threadId: 'new',
    date: new Date('2026-03-01T00:00:00Z'),
  })
  const picked = pickLatestLinkedThread([older, newer], DOCKET)
  assert.equal(picked?.threadId, 'new')
})

test('date is preferred over updatedAt', () => {
  const a = thread({
    threadId: 'a',
    date: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  })
  const b = thread({
    threadId: 'b',
    date: new Date('2026-02-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
  })
  assert.equal(pickLatestLinkedThread([a, b], DOCKET)?.threadId, 'b')
})

test('a missing date falls back to updatedAt', () => {
  const noDate = thread({
    threadId: 'no-date',
    date: null,
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  })
  const dated = thread({
    threadId: 'dated',
    date: new Date('2026-01-01T00:00:00Z'),
  })
  assert.equal(pickLatestLinkedThread([dated, noDate], DOCKET)?.threadId, 'no-date')
})

test('equal timestamps break on msgCount then threadId', () => {
  const small = thread({ threadId: 'aaa', msgCount: 1 })
  const big = thread({ threadId: 'bbb', msgCount: 5 })
  assert.equal(pickLatestLinkedThread([small, big], DOCKET)?.threadId, 'bbb')

  const x = thread({ threadId: 'aaa', msgCount: 2 })
  const y = thread({ threadId: 'zzz', msgCount: 2 })
  assert.equal(pickLatestLinkedThread([x, y], DOCKET)?.threadId, 'zzz')
})

test('a thread with a multi-docket column matches any of its dockets', () => {
  const multi = thread({
    threadId: 'multi',
    docketNo: 'GMD/26-27/412, GMD/26-27/413',
  })
  assert.equal(pickLatestLinkedThread([multi], 'GMD/2026-27/413')?.threadId, 'multi')
})

test('an exact key match beats a bare-serial fallback', () => {
  const bare = thread({
    threadId: 'bare',
    docketNo: '412',
    date: new Date('2026-06-01T00:00:00Z'),
  })
  const exact = thread({
    threadId: 'exact',
    date: new Date('2026-01-01T00:00:00Z'),
  })
  assert.equal(pickLatestLinkedThread([bare, exact], DOCKET)?.threadId, 'exact')
})

test('returns null when nothing links to the docket', () => {
  assert.equal(pickLatestLinkedThread([thread()], 'GMD/2026-27/999'), null)
  assert.equal(pickLatestLinkedThread([thread()], null), null)
  assert.equal(pickLatestLinkedThread([thread()], ''), null)
})

test('a thread with no docket number is never picked', () => {
  const blank = thread({ threadId: 'blank', docketNo: null })
  assert.equal(pickLatestLinkedThread([blank], DOCKET), null)
})

test('a partial numeric overlap does not create a false match', () => {
  const other = thread({ threadId: 'other', docketNo: 'GMD/2026-27/1412' })
  assert.equal(pickLatestLinkedThread([other], DOCKET), null)
})
