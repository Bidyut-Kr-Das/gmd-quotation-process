import test from 'node:test'
import assert from 'node:assert/strict'
import { compare, matchExistingBoms, nextBomIds, proposeBoms, ruleSchema, type BomRuleInput } from '../lib/autoBom.js'

test('equals ignores case and extra whitespace', () => {
  assert.equal(compare('equals', ' flange   type ', 'FLANGE TYPE'), true)
  assert.equal(compare('equals', '9523', '1538'), false)
})

test('filters can test for blank, match operators never match blank', () => {
  assert.equal(compare('equals', null, ''), true)
  assert.equal(compare('notEquals', '', 'FLANGE TYPE'), true)
  assert.equal(compare('contains', '', 'FLANGE TYPE'), false)
  assert.equal(compare('anyPart', 'DUCTILE IRON', null), false)
  assert.equal(compare('anyNumber', '', ''), false)
})

test('contains works in either direction', () => {
  assert.equal(compare('contains', 'SLUICE VALVE-METAL-NON-RISING', 'Sluice Valve'), true)
  assert.equal(compare('contains', 'NON-RISING', 'SLUICE VALVE-METAL-NON-RISING'), true)
  assert.equal(compare('contains', 'BUTTERFLY VALVE', 'SLUICE VALVE'), false)
})

test('anyPart splits on slash', () => {
  assert.equal(compare('anyPart', 'DUCTILE IRON/CAST IRON', 'DUCTILE IRON'), true)
  assert.equal(compare('anyPart', 'CAST STEEL/CARBON STEEL', 'CARBON STEEL/ CAST STEEL'), true)
  assert.equal(compare('anyPart', 'DUCTILE IRON/CAST IRON', 'STAINLESS STEEL'), false)
})

test('anyNumber compares numbers only', () => {
  assert.equal(compare('anyNumber', '150', '150MM'), true)
  assert.equal(compare('anyNumber', 'PN-10/16', 'PN-16'), true)
  assert.equal(compare('anyNumber', '150', '155MM'), false)
  assert.equal(compare('anyNumber', '15', '150MM'), false)
  assert.equal(compare('anyNumber', 'NA', 'PN-16'), false)
})

const fullItems = [
  { id: 'f1', itemType: 'BUTTERFLY VALVE', moc: 'DUCTILE IRON/CAST IRON', size: '150' },
  { id: 'f2', itemType: 'BUTTERFLY VALVE', moc: 'DUCTILE IRON/CAST IRON', size: '900' },
  { id: 'f3', itemType: 'CHECK VALVE', moc: 'DUCTILE IRON/CAST IRON', size: '150' },
]

const rawMaterials = [
  { id: 'r1', l2ValveType: 'BUTTERFLY VALVE', l3Dia: '150MM', l5Material: 'DUCTILE IRON', l6Std: 'FLANGE TYPE', rmType: '' },
  { id: 'r2', l2ValveType: 'BUTTERFLY VALVE', l3Dia: '150MM', l5Material: 'DUCTILE IRON', l6Std: 'FLANGE TYPE', rmType: '9523' },
  { id: 'r3', l2ValveType: 'BUTTERFLY VALVE', l3Dia: '150MM', l5Material: 'DUCTILE IRON', l6Std: 'WAFER TYPE', rmType: '' },
  { id: 'r4', l2ValveType: 'BUTTERFLY VALVE', l3Dia: '', l5Material: 'DUCTILE IRON', l6Std: 'FLANGE TYPE', rmType: '' },
  { id: 'r5', l2ValveType: 'BUTTERFLY VALVE', l3Dia: '150MM', l5Material: 'STAINLESS STEEL', l6Std: 'FLANGE TYPE', rmType: '' },
]

const flangeRule: BomRuleInput = {
  name: 'Butterfly flange',
  bomMode: 'PER_MATCH',
  conditions: [
    { kind: 'fullItemFilter', field: 'itemType', operator: 'equals', value: 'butterfly valve' },
    { kind: 'match', fullItemField: 'size', operator: 'anyNumber', rawMaterialField: 'l3Dia' },
    { kind: 'match', fullItemField: 'moc', operator: 'anyPart', rawMaterialField: 'l5Material' },
    { kind: 'rawMaterialFilter', field: 'l6Std', operator: 'equals', value: 'FLANGE TYPE' },
  ],
}

test('PER_MATCH creates one BOM per matched raw material', () => {
  const result = proposeBoms(flangeRule, fullItems, rawMaterials)
  assert.deepEqual(result.proposals, [
    { fullItemId: 'f1', rawMaterialIds: ['r1'] },
    { fullItemId: 'f1', rawMaterialIds: ['r2'] },
  ])
  // f2 passes the full item filter but nothing matches its size; f3 is filtered out.
  assert.deepEqual(result.unmatchedFullItemIds, ['f2'])
})

test('ALL_IN_ONE creates one BOM holding every match', () => {
  const result = proposeBoms({ ...flangeRule, bomMode: 'ALL_IN_ONE' }, fullItems, rawMaterials)
  assert.deepEqual(result.proposals, [{ fullItemId: 'f1', rawMaterialIds: ['r1', 'r2'] }])
})

test('a raw material filter on blank narrows to the plain flange type', () => {
  const rule: BomRuleInput = {
    ...flangeRule,
    conditions: [...flangeRule.conditions, { kind: 'rawMaterialFilter', field: 'rmType', operator: 'equals', value: '' }],
  }
  assert.deepEqual(proposeBoms(rule, fullItems, rawMaterials).proposals, [{ fullItemId: 'f1', rawMaterialIds: ['r1'] }])
})

test('nextBomIds continues the NEW-BOM series and ignores other ids', () => {
  assert.deepEqual(nextBomIds([], 2), ['NEW-BOM-001', 'NEW-BOM-002'])
  assert.deepEqual(nextBomIds(['G2-C0001-167', 'NEW-BOM-007', 'NEW-BOM-003', 'NEW-BOM-X'], 2), ['NEW-BOM-008', 'NEW-BOM-009'])
  assert.deepEqual(nextBomIds(['NEW-BOM-999'], 1), ['NEW-BOM-1000'])
})

test('ruleSchema rejects rules that cannot match anything sensible', () => {
  assert.equal(ruleSchema.safeParse(flangeRule).success, true)
  assert.equal(ruleSchema.safeParse({ ...flangeRule, bomIdType: '2:1' }).success, true)
  assert.equal(ruleSchema.safeParse({ ...flangeRule, bomIdType: null }).success, true)
  assert.equal(ruleSchema.safeParse({ ...flangeRule, bomIdType: '5:1' }).success, false)
  assert.equal(ruleSchema.safeParse({ ...flangeRule, name: '  ' }).success, false)
  assert.equal(ruleSchema.safeParse({ ...flangeRule, conditions: flangeRule.conditions.filter((c) => c.kind !== 'match') }).success, false)
  assert.equal(
    ruleSchema.safeParse({ ...flangeRule, conditions: [{ kind: 'match', fullItemField: 'password', operator: 'equals', rawMaterialField: 'l3Dia' }] }).success,
    false,
  )
  assert.equal(
    ruleSchema.safeParse({ ...flangeRule, conditions: [{ kind: 'match', fullItemField: 'size', operator: 'notEquals', rawMaterialField: 'l3Dia' }] }).success,
    false,
  )
})

test('matchExistingBoms finds auto-created BOMs a rule describes', () => {
  const boms = [
    { id: 'b1', bomId: 'NEW-BOM-001', fullItemId: 'f1', rawMaterialIds: ['r1'] },
    // r3 is WAFER TYPE, so the flange rule does not describe this BOM.
    { id: 'b2', bomId: 'NEW-BOM-002', fullItemId: 'f1', rawMaterialIds: ['r3'] },
    // Every raw material has to match, not just one.
    { id: 'b3', bomId: 'NEW-BOM-003', fullItemId: 'f1', rawMaterialIds: ['r1', 'r3'] },
    { id: 'b4', bomId: 'NEW-BOM-004', fullItemId: 'f1', rawMaterialIds: ['r1', 'r2'] },
    // Owner fails the full item filter.
    { id: 'b5', bomId: 'NEW-BOM-005', fullItemId: 'f3', rawMaterialIds: ['r1'] },
    { id: 'b6', bomId: 'NEW-BOM-006', fullItemId: 'f1', rawMaterialIds: [] },
  ]
  assert.deepEqual(matchExistingBoms(flangeRule, boms, fullItems, rawMaterials), ['b1', 'b4'])
})

test('matchExistingBoms never returns a BOM that was not auto-created', () => {
  const boms = [
    { id: 'e1', bomId: 'G2-C0001-167', fullItemId: 'f1', rawMaterialIds: ['r1'] },
    { id: 'e2', bomId: 'A', fullItemId: 'f1', rawMaterialIds: ['r1'] },
    { id: 'e3', bomId: 'XNEW-BOM-001', fullItemId: 'f1', rawMaterialIds: ['r1'] },
  ]
  assert.deepEqual(matchExistingBoms(flangeRule, boms, fullItems, rawMaterials), [])
})
