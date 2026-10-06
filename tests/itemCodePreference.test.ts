import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isCurrentReqtYes,
  pickPreferredItemCodeRows,
} from '../lib/gmd_lib/item-code-preference.js'

function row(
  itemCode: string,
  currentReqt: string | null,
  overrides: Partial<{
    itemType: string
    moc: string
    operation: string
    size: string
    pnGmd: string
  }> = {},
) {
  return {
    itemCode,
    itemType: 'SLUICE VALVE',
    moc: 'DI',
    operation: 'GB',
    size: '450',
    pnGmd: 'PN-10',
    currentReqt,
    ...overrides,
  }
}

test('isCurrentReqtYes only accepts a literal YES', () => {
  assert.equal(isCurrentReqtYes('YES'), true)
  assert.equal(isCurrentReqtYes(' yes '), true)
  assert.equal(isCurrentReqtYes('Yes'), true)
  assert.equal(isCurrentReqtYes('NO'), false)
  assert.equal(isCurrentReqtYes('N'), false)
  assert.equal(isCurrentReqtYes(''), false)
  assert.equal(isCurrentReqtYes(null), false)
  assert.equal(isCurrentReqtYes(undefined), false)
})

test('a YES row beats an earlier NO row for the same parameters', () => {
  const no = row('FBC000001', 'NO')
  const yes = row('FBC000002', 'YES')
  const picked = pickPreferredItemCodeRows([no, yes])
  assert.deepEqual(picked, [yes])
})

test('YES wins regardless of sheet order', () => {
  const no = row('FBC000001', 'NO')
  const yes = row('FBC000002', 'YES')
  assert.deepEqual(pickPreferredItemCodeRows([yes, no]), [yes])
})

test('when no YES row exists the first row is kept', () => {
  const first = row('FBC000001', 'NO')
  const second = row('FBC000002', 'NO')
  assert.deepEqual(pickPreferredItemCodeRows([first, second]), [first])
})

test('a blank current reqt is not treated as YES but still falls back', () => {
  const blank = row('FBC000001', null)
  const yes = row('FBC000002', 'YES')
  assert.deepEqual(pickPreferredItemCodeRows([blank, yes]), [yes])
  assert.deepEqual(pickPreferredItemCodeRows([blank]), [blank])
})

test('different parameter combinations are all preserved, first occurrence order kept', () => {
  const a = row('FBC000001', 'NO', { size: '450' })
  const b = row('FBC000002', 'YES', { size: '600' })
  const aYes = row('FBC000003', 'YES', { size: '450' })
  const picked = pickPreferredItemCodeRows([a, b, aYes])
  assert.deepEqual(picked, [aYes, b])
})
