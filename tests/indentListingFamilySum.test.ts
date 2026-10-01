import test from 'node:test'
import assert from 'node:assert/strict'
import { applySlvFamilySums } from '../lib/indentListingFamilySum.js'

// [item, size, pn, mc, total, v1, v2, v3, v4, v1cat, v2cat, v3cat, v4cat, rm1, rm2, rm3, rm4]
function row(overrides: {
  item: string
  size?: string
  pn?: string
  mc?: string
  total?: string | null
  v?: (string | null)[]
  cats?: string[]
  rms?: string[]
}): unknown[] {
  const {
    item,
    size = '200',
    pn = 'PN - 16',
    mc = 'Pending',
    total = '0',
    v = ['', '', '', ''],
    cats = ['', '', '', ''],
    rms = ['', '', '', ''],
  } = overrides
  return [item, size, pn, mc, total, ...v, ...cats, ...rms]
}

test('SLV and TPAV+SLV with same size/PN/MC get the family total and variant sums', () => {
  const slv = row({
    item: 'SLV',
    total: '100',
    v: ['10', '20', '30', '40'],
    cats: ['Base', '9523', 'Rising', 'Rising 9523'],
    rms: ['RM-A', 'RM-B', 'RM-C', 'RM-D'],
  })
  const tpav = row({
    item: 'TPAV+SLV',
    total: '500',
    v: ['1', '2', '3', '4'],
    cats: ['Base', '9523', 'Rising', 'Rising 9523'],
    rms: ['RM-W', 'RM-X', 'RM-Y', 'RM-Z'],
  })

  const [outSlv, outTpav] = applySlvFamilySums([slv, tpav])

  assert.equal(outSlv[4], '600')
  assert.deepEqual(outSlv.slice(5, 9), ['11', '22', '33', '44'])
  assert.equal(outTpav[4], '600')
  assert.deepEqual(outTpav.slice(5, 9), ['11', '22', '33', '44'])

  // Each row keeps its own categories and RM codes.
  assert.deepEqual(outSlv.slice(9, 13), ['Base', '9523', 'Rising', 'Rising 9523'])
  assert.deepEqual(outTpav.slice(9, 13), ['Base', '9523', 'Rising', 'Rising 9523'])
  assert.deepEqual(outSlv.slice(13, 17), ['RM-A', 'RM-B', 'RM-C', 'RM-D'])
  assert.deepEqual(outTpav.slice(13, 17), ['RM-W', 'RM-X', 'RM-Y', 'RM-Z'])
})

test('a blank slot on one side takes the other value; both blank stays blank', () => {
  const slv = row({
    item: 'SLV',
    total: '100',
    v: ['10', '', '', ''],
  })
  const tpav = row({
    item: 'TPAV+SLV',
    total: '500',
    v: ['', '2', '', ''],
  })

  const [outSlv, outTpav] = applySlvFamilySums([slv, tpav])

  assert.deepEqual(outSlv.slice(5, 9), ['10', '2', '', ''])
  assert.deepEqual(outTpav.slice(5, 9), ['10', '2', '', ''])
  assert.equal(outSlv[4], '600')
})

test('rows are only paired when size, PN and MC all match', () => {
  const slv = row({ item: 'SLV', size: '200', pn: 'PN - 16', total: '100' })
  const tpavWrongSize = row({
    item: 'TPAV+SLV',
    size: '300',
    pn: 'PN - 16',
    total: '500',
  })
  const tpavWrongPn = row({
    item: 'TPAV+SLV',
    size: '200',
    pn: 'PN - 25',
    total: '500',
  })
  const tpavWrongMc = row({
    item: 'TPAV+SLV',
    size: '200',
    pn: 'PN - 16',
    mc: 'Received',
    total: '500',
  })

  const input = [slv, tpavWrongSize, tpavWrongPn, tpavWrongMc]
  const out = applySlvFamilySums(input)

  assert.equal(out[0], slv)
  assert.equal(out[1], tpavWrongSize)
  assert.equal(out[2], tpavWrongPn)
  assert.equal(out[3], tpavWrongMc)
})

test('matching ignores casing and extra whitespace in the key fields', () => {
  const slv = row({ item: 'SLV', size: ' 200 ', pn: 'pn - 16', mc: 'pending', total: '100' })
  const tpav = row({
    item: 'TPAV+SLV',
    size: '200',
    pn: 'PN   -   16',
    mc: 'PENDING',
    total: '500',
  })

  const [outSlv, outTpav] = applySlvFamilySums([slv, tpav])

  assert.equal(outSlv[4], '600')
  assert.equal(outTpav[4], '600')
})

test('other base items and unpaired rows are returned untouched', () => {
  const bfv = row({ item: 'BFV', total: '700' })
  const loneSlv = row({ item: 'SLV', size: '400', total: '100' })
  const loneTpav = row({ item: 'TPAV+SLV', size: '500', total: '500' })

  const input = [bfv, loneSlv, loneTpav]
  const out = applySlvFamilySums(input)

  assert.equal(out[0], bfv)
  assert.equal(out[1], loneSlv)
  assert.equal(out[2], loneTpav)
})

test('a numeric sum rounds away floating point noise', () => {
  const slv = row({ item: 'SLV', total: '0.1', v: ['0.1', '', '', ''] })
  const tpav = row({ item: 'TPAV+SLV', total: '0.2', v: ['0.2', '', '', ''] })

  const [outSlv] = applySlvFamilySums([slv, tpav])

  assert.equal(outSlv[4], '0.3')
  assert.equal(outSlv[5], '0.3')
})
