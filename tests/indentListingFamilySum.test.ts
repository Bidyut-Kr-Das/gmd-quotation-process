import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTpavSlvMerge } from '../lib/indentListingFamilySum.js'

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

function merge(rows: unknown[][]) {
  return applyTpavSlvMerge(rows, rows.map((_, i) => `id${i}`))
}

function byItem(rows: unknown[][]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {}
  for (const r of rows) out[String(r[0])] = r
  return out
}

test('TPAV+SLV is added to both TPAV and SLV, and the TPAV+SLV row is removed', () => {
  const tpav = row({ item: 'TPAV', total: '100', v: ['100', '', '', ''], cats: ['Base'] })
  const slv = row({ item: 'SLV', total: '200', v: ['200', '', '', ''], cats: ['Base'] })
  const tslv = row({ item: 'TPAV+SLV', total: '50', v: ['50', '', '', ''], cats: ['Base'] })

  const { rows, ids } = merge([tpav, slv, tslv])

  assert.equal(rows.length, 2)
  assert.equal(ids.length, 2)
  const m = byItem(rows)
  assert.equal(m['TPAV']?.[4], '150')
  assert.equal(m['TPAV']?.[5], '150')
  assert.equal(m['SLV']?.[4], '250')
  assert.equal(m['SLV']?.[5], '250')
  assert.equal(m['TPAV+SLV'], undefined)
})

test('variant routing: 9523 goes to SLV V2 and TPAV V4', () => {
  const tpav = row({ item: 'TPAV', total: '10', v: ['10', '', '', ''], cats: ['Base'] })
  const slv = row({ item: 'SLV', total: '7', v: ['', '7', '', ''], cats: ['', '9523'] })
  const tslv = row({ item: 'TPAV+SLV', total: '50', v: ['', '50', '', ''], cats: ['', '9523'] })

  const m = byItem(merge([tpav, slv, tslv]).rows)

  // SLV keeps the same slot.
  assert.equal(m['SLV']?.[6], '57')
  // TPAV re-homes 9523 from V2 to V4.
  assert.equal(m['TPAV']?.[8], '50')
  assert.equal(m['TPAV']?.[6], '')
  assert.equal(m['TPAV']?.[4], '60')
})

test('variant routing: Rising -> SLV V3 and TPAV V2; Rising 9523 -> SLV V4 and TPAV V4', () => {
  const tslv = row({
    item: 'TPAV+SLV',
    total: '70',
    v: ['', '', '30', '40'],
    cats: ['', '', 'Rising', 'Rising 9523'],
  })

  const m = byItem(merge([tslv]).rows)

  assert.equal(m['SLV']?.[7], '30')
  assert.equal(m['SLV']?.[8], '40')
  assert.equal(m['SLV']?.[9 + 2], 'Rising')
  assert.equal(m['TPAV']?.[6], '30')
  assert.equal(m['TPAV']?.[8], '40')
  assert.equal(m['TPAV']?.[4], '70')
})

test('missing SLV/TPAV targets are synthesized so no balance is lost', () => {
  const tslv = row({ item: 'TPAV+SLV', total: '80', v: ['80', '', '', ''], cats: ['Base'] })

  const { rows, ids } = merge([tslv])

  assert.equal(rows.length, 2)
  assert.equal(ids.length, 2)
  const m = byItem(rows)
  assert.equal(m['SLV']?.[4], '80')
  assert.equal(m['TPAV']?.[4], '80')
})

test('key mismatch creates its own target group; other rows are untouched', () => {
  const slv200 = row({ item: 'SLV', size: '200', total: '100', v: ['100', '', '', ''], cats: ['Base'] })
  const tslv300 = row({ item: 'TPAV+SLV', size: '300', total: '500', v: ['500', '', '', ''], cats: ['Base'] })

  const { rows } = merge([slv200, tslv300])

  // The 200 SLV is not touched by the 300 compound.
  const slv200Out = rows.find((r) => r[0] === 'SLV' && r[1] === '200')
  assert.ok(slv200Out)
  assert.equal(slv200Out[4], '100')
  assert.equal(slv200Out[5], '100')
  // A 300 SLV + 300 TPAV pair is synthesized.
  const s300 = rows.filter((r) => r[0] === 'SLV' && r[1] === '300')
  const t300 = rows.filter((r) => r[0] === 'TPAV' && r[1] === '300')
  assert.equal(s300.length, 1)
  assert.equal(t300.length, 1)
  assert.equal(s300[0][4], '500')
  assert.equal(t300[0][4], '500')
  assert.equal(rows.some((r) => r[0] === 'TPAV+SLV'), false)
})

test('matching ignores casing and extra whitespace in size/PN/MC', () => {
  const slv = row({ item: 'SLV', size: ' 200 ', pn: 'pn - 16', mc: 'pending', total: '100', v: ['100', '', '', ''], cats: ['Base'] })
  const tslv = row({ item: 'TPAV+SLV', size: '200', pn: 'PN   -   16', mc: 'PENDING', total: '50', v: ['50', '', '', ''], cats: ['Base'] })

  const { rows } = merge([slv, tslv])

  // No extra synthesized rows: the normalized keys matched.
  assert.equal(rows.length, 2)
  const m = byItem(rows)
  assert.equal(m['SLV']?.[4], '150')
  assert.equal(m['TPAV']?.[4], '50')
})

test('other base items (BFV, SLV METAL) are not targets and stay as-is', () => {
  const bfv = row({ item: 'BFV', total: '700' })
  const slvMetal = row({ item: 'SLV METAL', total: '900' })
  const input = [bfv, slvMetal]
  const { rows } = merge(input)

  assert.equal(rows[0], bfv)
  assert.equal(rows[1], slvMetal)
})

test('numeric sums round away floating point noise', () => {
  const slv = row({ item: 'SLV', total: '0.1', v: ['0.1', '', '', ''], cats: ['Base'] })
  const tslv = row({ item: 'TPAV+SLV', total: '0.2', v: ['0.2', '', '', ''], cats: ['Base'] })

  const m = byItem(merge([slv, tslv]).rows)

  assert.equal(m['SLV']?.[4], '0.3')
  assert.equal(m['SLV']?.[5], '0.3')
  assert.equal(m['TPAV']?.[4], '0.2')
})

test('multiple variants accumulate into the same synthesized target slots', () => {
  const tslv = row({
    item: 'TPAV+SLV',
    total: '30',
    v: ['10', '20', '', ''],
    cats: ['Base', '9523', '', ''],
  })

  const m = byItem(merge([tslv]).rows)

  assert.equal(m['SLV']?.[5], '10')
  assert.equal(m['SLV']?.[6], '20')
  // TPAV: Base -> V1, 9523 -> V4.
  assert.equal(m['TPAV']?.[5], '10')
  assert.equal(m['TPAV']?.[8], '20')
})
