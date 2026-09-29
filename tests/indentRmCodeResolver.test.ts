import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planIndentRmCodes,
  rmCodeSizeKey,
  rmCodeRequiredMaterial,
  RM_CODE_CARBON_STEEL,
  type IndentRmCodeInput,
  type RawMaterialMatchRow,
} from '../lib/indentRmCodeResolver.js'

function indent(overrides: Partial<IndentRmCodeInput> = {}): IndentRmCodeInput {
  return {
    id: 'a',
    item: 'SLV',
    size: '200',
    pnRating: 'PN-10/16',
    v1: '10',
    v2: '',
    v3: '',
    v4: '',
    v1Category: 'Base',
    v2Category: '',
    v3Category: '',
    v4Category: '',
    ...overrides,
  }
}

function rm(overrides: Partial<RawMaterialMatchRow> = {}): RawMaterialMatchRow {
  return {
    erpItemCode: 'RSD120003',
    l2ValveType: 'SLUICE VALVE',
    l3Dia: '200MM',
    l4Component: 'METAL TO RUBBER',
    l5Material: 'DUCTILE IRON',
    l6Std: 'NON-RISING',
    l7Dimension: 'PN-16',
    l8ItemCategory: 'TRADING VALVES',
    ...overrides,
  }
}

test('size keys strip the unit suffix', () => {
  assert.equal(rmCodeSizeKey('200MM'), '200')
  assert.equal(rmCodeSizeKey('200 mm'), '200')
  assert.equal(rmCodeSizeKey(' 200 '), '200')
  assert.equal(rmCodeSizeKey('12.5MM'), '12.5')
  assert.equal(rmCodeSizeKey('6IN'), '6')
  assert.equal(rmCodeSizeKey(''), '')
  assert.equal(rmCodeSizeKey(null), '')
})

test('V1 resolves to the NON-RISING raw material', () => {
  const plan = planIndentRmCodes([indent()], [rm()])
  assert.equal(plan.updates.length, 1)
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
  assert.equal(plan.updates[0].rmCodeV2, '')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.unmatched, 0)
})

test('each V slot maps to its own L6 standard', () => {
  const raw = [
    rm({ erpItemCode: 'V1CODE', l6Std: 'NON-RISING' }),
    rm({ erpItemCode: 'V2CODE', l6Std: 'NON-RISING-9523' }),
    rm({ erpItemCode: 'V3CODE', l6Std: 'RISING' }),
    rm({ erpItemCode: 'V4CODE', l6Std: 'RISING-9523' }),
  ]
  const plan = planIndentRmCodes(
    [indent({ v1: '1', v2: '2', v3: '3', v4: '4' })],
    raw,
  )
  const u = plan.updates[0]
  assert.equal(u.rmCodeV1, 'V1CODE')
  assert.equal(u.rmCodeV2, 'V2CODE')
  assert.equal(u.rmCodeV3, 'V3CODE')
  assert.equal(u.rmCodeV4, 'V4CODE')
  assert.equal(plan.resolved, 4)
})

test('SLV maps to METAL TO RUBBER and SLV METAL to METAL TO METAL', () => {
  const raw = [
    rm({ erpItemCode: 'RUBBER1', l4Component: 'METAL TO RUBBER' }),
    rm({ erpItemCode: 'METAL1', l4Component: 'METAL TO METAL' }),
  ]
  const slv = planIndentRmCodes([indent({ item: 'SLV' })], raw)
  assert.equal(slv.updates[0].rmCodeV1, 'RUBBER1')

  const metal = planIndentRmCodes([indent({ item: 'SLV METAL' })], raw)
  assert.equal(metal.updates[0].rmCodeV1, 'METAL1')
})

test('the PN rating is bucketed on both sides', () => {
  // "PN - 16" on the raw material side must meet "PN-10/16" on the indent side.
  const plan = planIndentRmCodes(
    [indent({ pnRating: 'PN-10/16' })],
    [rm({ l7Dimension: 'PN - 16' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')

  // A different bucket must not match.
  const miss = planIndentRmCodes(
    [indent({ pnRating: 'PN-10/16' })],
    [rm({ l7Dimension: 'PN - 25' })],
  )
  assert.equal(miss.updates[0].rmCodeV1, '')
  assert.equal(miss.unmatched, 1)
})

test('the item category is matched on L8 and the valve type on L2', () => {
  const wrongCategory = planIndentRmCodes(
    [indent()],
    [rm({ l8ItemCategory: 'SPARES' })],
  )
  assert.equal(wrongCategory.updates[0].rmCodeV1, '')

  const wrongValveType = planIndentRmCodes(
    [indent()],
    [rm({ l2ValveType: 'BUTTERFLY VALVE' })],
  )
  assert.equal(wrongValveType.updates[0].rmCodeV1, '')
})

test('duplicate erpItemCode rows collapse to a single code', () => {
  // GMDUpdateItem has no unique index on erpItemCode, so a sheet can repeat one.
  const plan = planIndentRmCodes([indent()], [rm(), rm()])
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.ambiguous, 0)
})

test('multiple matches are comma joined and counted as ambiguous', () => {
  const plan = planIndentRmCodes(
    [indent()],
    [rm({ erpItemCode: 'RSD110004' }), rm({ erpItemCode: 'RSD110041' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'RSD110004, RSD110041')
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.resolved, 0)
})

test('ambiguous matches are sorted so the output is stable', () => {
  const plan = planIndentRmCodes(
    [indent()],
    [rm({ erpItemCode: 'ZZZ999999' }), rm({ erpItemCode: 'AAA111111' })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'AAA111111, ZZZ999999')
})

test('an empty V column is never matched', () => {
  const plan = planIndentRmCodes([indent({ v1: '' })], [rm()])
  assert.equal(plan.updates[0].rmCodeV1, '')
  // Nothing was populated, so nothing was resolved or counted as unmatched.
  assert.equal(plan.resolved, 0)
  assert.equal(plan.unmatched, 0)
})

test('a zero balance still counts as a populated variant', () => {
  const plan = planIndentRmCodes([indent({ v1: '0' })], [rm()])
  assert.equal(plan.updates[0].rmCodeV1, 'RSD120003')
})

test('a CS category requires a carbon steel raw material', () => {
  // "Rising CS" records the body material (cast/carbon steel), so it must not
  // be satisfied by a ductile iron code of the wrong material.
  const plan = planIndentRmCodes(
    [
      indent({
        v1: '',
        v2: '',
        v3: '8',
        v3Category: 'Rising CS',
      }),
    ],
    [rm({ l6Std: 'RISING' })],
  )
  assert.equal(plan.updates[0].rmCodeV3, '')
  assert.equal(plan.unmatched, 1)
})

test('a CS category matches a carbon steel raw material when one exists', () => {
  const plan = planIndentRmCodes(
    [indent({ v1: '', v3: '8', v3Category: 'Rising CS' })],
    [
      rm({ erpItemCode: 'RGS010014', l6Std: 'RISING', l5Material: RM_CODE_CARBON_STEEL }),
      rm({ erpItemCode: 'RSD110003', l6Std: 'RISING' }),
    ],
  )
  assert.equal(plan.updates[0].rmCodeV3, 'RGS010014')
  assert.equal(plan.resolved, 1)
})

test('a non-CS category matches any material', () => {
  const plan = planIndentRmCodes(
    [indent({ v1Category: 'Base' })],
    [rm(), rm({ erpItemCode: 'OTHER1', l5Material: RM_CODE_CARBON_STEEL })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'OTHER1, RSD120003')
  assert.equal(plan.ambiguous, 1)
})

test('a blank category does not constrain the material', () => {
  const plan = planIndentRmCodes(
    [indent({ v1Category: '' })],
    [rm(), rm({ erpItemCode: 'OTHER1', l5Material: RM_CODE_CARBON_STEEL })],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'OTHER1, RSD120003')
})

test('the material requirement is read from the slot category only', () => {
  // A CS label on a different slot must not affect this one.
  const plan = planIndentRmCodes(
    [indent({ v1: '1', v1Category: 'Base', v2: '2', v2Category: 'Rising CS' })],
    [
      rm({ erpItemCode: 'V1CODE', l6Std: 'NON-RISING' }),
      rm({ erpItemCode: 'V2CS', l6Std: 'NON-RISING-9523' }),
    ],
  )
  assert.equal(plan.updates[0].rmCodeV1, 'V1CODE')
  assert.equal(plan.updates[0].rmCodeV2, '')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.unmatched, 1)
})

test('rmCodeRequiredMaterial only constrains on a CS token', () => {
  assert.equal(rmCodeRequiredMaterial('Rising CS'), RM_CODE_CARBON_STEEL)
  assert.equal(rmCodeRequiredMaterial('rising cs'), RM_CODE_CARBON_STEEL)
  assert.equal(rmCodeRequiredMaterial('Base, Rising CS'), RM_CODE_CARBON_STEEL)
  assert.equal(rmCodeRequiredMaterial('Base'), null)
  assert.equal(rmCodeRequiredMaterial('9523'), null)
  assert.equal(rmCodeRequiredMaterial('Rising 9523'), null)
  assert.equal(rmCodeRequiredMaterial('Rising'), null)
  assert.equal(rmCodeRequiredMaterial('CS2'), null)
  assert.equal(rmCodeRequiredMaterial(''), null)
  assert.equal(rmCodeRequiredMaterial(null), null)
})

test('rows outside SLV and SLV METAL are skipped entirely', () => {
  const raw = [rm()]
  for (const item of ['TPAV+SLV', 'BFV', 'DPCV', 'NRV', null]) {
    const plan = planIndentRmCodes([indent({ item })], raw)
    assert.equal(plan.updates.length, 0, `expected ${item} to be skipped`)
  }
})

test('rows without a usable size or PN rating are skipped', () => {
  assert.equal(planIndentRmCodes([indent({ size: null })], [rm()]).updates.length, 0)
  assert.equal(planIndentRmCodes([indent({ size: '  ' })], [rm()]).updates.length, 0)
  assert.equal(planIndentRmCodes([indent({ pnRating: null })], [rm()]).updates.length, 0)
})

test('raw materials with a blank code or a blank key part are ignored', () => {
  assert.equal(planIndentRmCodes([indent()], [rm({ erpItemCode: '  ' })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l3Dia: null })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l4Component: null })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l6Std: null })]).unmatched, 1)
  assert.equal(planIndentRmCodes([indent()], [rm({ l7Dimension: null })]).unmatched, 1)
})

test('the resolver reports a count for every populated slot', () => {
  const raw = [
    rm({ erpItemCode: 'HIT1' }),
    rm({ erpItemCode: 'HIT2' }),
    rm({ erpItemCode: 'RISING1', l6Std: 'RISING' }),
  ]
  const plan = planIndentRmCodes(
    [
      // v1 matches two raw materials, v3 matches one, v2 and v4 match none.
      indent({ id: 'r1', v1: '1', v2: '1', v3: '1', v4: '1' }),
      // A size with no raw material at all.
      indent({ id: 'r2', size: '999' }),
    ],
    raw,
  )
  assert.equal(plan.updates.length, 2)
  assert.equal(plan.updates[0].rmCodeV1, 'HIT1, HIT2')
  assert.equal(plan.updates[0].rmCodeV2, '')
  assert.equal(plan.updates[0].rmCodeV3, 'RISING1')
  assert.equal(plan.updates[0].rmCodeV4, '')
  assert.equal(plan.resolved, 1)
  assert.equal(plan.ambiguous, 1)
  assert.equal(plan.unmatched, 3)
  // Nothing is double counted: all 5 populated slots land in exactly one bucket.
  assert.equal(plan.resolved + plan.ambiguous + plan.unmatched, 5)
})
