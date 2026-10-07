import test from 'node:test'
import assert from 'node:assert/strict'
import { parseItem, BASE_ITEMS, SLV_TYPES } from '../lib/itemVersionResolver.js'

test('BASE_ITEMS contains only the allowed item set', () => {
  assert.deepEqual(
    [...BASE_ITEMS].sort(),
    [
      'BFV',
      'CF',
      'DPCV',
      'DV',
      'GV',
      'NRV',
      'PRV',
      'SLV',
      'SLV METAL',
      'TPAV',
      'TPAV+SLV',
    ].sort(),
  )
})

test('SLV_TYPES covers the SLV-family base items', () => {
  assert.equal(SLV_TYPES.has('SLV'), true)
  assert.equal(SLV_TYPES.has('TPAV+SLV'), true)
  assert.equal(SLV_TYPES.has('SLV METAL'), true)
  assert.equal(SLV_TYPES.has('BFV'), false)
})

test('SLV family: plain -> V1, 9523 -> V2, RISING -> V3, RISING+9523 -> V4', () => {
  assert.deepEqual(parseItem('SLV'), {
    baseItem: 'SLV',
    slot: 1,
    variant: 'PLAIN',
    label: 'Base',
    hasVersionExtras: false,
  })
  assert.deepEqual(parseItem('SLV-9523'), {
    baseItem: 'SLV',
    slot: 2,
    variant: '9523',
    label: '9523',
    hasVersionExtras: true,
  })
  assert.deepEqual(parseItem('SLV RISING'), {
    baseItem: 'SLV',
    slot: 3,
    variant: 'RISING',
    label: 'Rising',
    hasVersionExtras: true,
  })
  assert.deepEqual(parseItem('SLV-RISING-9523'), {
    baseItem: 'SLV',
    slot: 4,
    variant: 'RISING_9523',
    label: 'Rising 9523',
    hasVersionExtras: true,
  })
})

test('variant labels cover DI/CS/Wafer and combine multiple suffixes', () => {
  assert.equal(parseItem('BFV-DI').label, 'DI')
  assert.equal(parseItem('DPCV-CS').label, 'CS')
  assert.equal(parseItem('BFV-WAFER').label, 'Wafer')
  // A CS suffix is the body material and must survive: it is the only record
  // that the valve is cast/carbon steel, since a completed recompute collapses
  // `item` to the base item and throws the variant suffixes away.
  assert.equal(parseItem('SLV RISING-CS').label, 'Rising CS')
  assert.equal(parseItem('SLV RISING-CS').slot, 3)
  assert.equal(parseItem('SLV RISING-CS').baseItem, 'SLV')
  assert.equal(parseItem('DPCV-RISING-CS').label, 'Rising CS')
})

test('a collapsed table carries no variant suffix, so hasVersionExtras is false', () => {
  // This is the guard the recompute action relies on to avoid re-collapsing an
  // already-computed table and funnelling every balance into V1.
  for (const item of ['SLV', 'SLV METAL', 'TPAV+SLV', 'BFV', 'DPCV', 'NRV', 'PRV']) {
    assert.equal(parseItem(item).hasVersionExtras, false, item)
  }
  // Before the collapse the suffixes are present, so a recompute is meaningful.
  for (const item of ['SLV-9523', 'SLV RISING', 'SLV RISING-9523']) {
    assert.equal(parseItem(item).hasVersionExtras, true, item)
  }
})

test('TPAV+SLV and SLV METAL follow the same SLV-family slot mapping', () => {
  assert.equal(parseItem('TPAV+SLV').slot, 1)
  assert.equal(parseItem('TPAV+SLV 9523').slot, 2)
  assert.equal(parseItem('TPAV+SLV 9523').baseItem, 'TPAV+SLV')
  assert.equal(parseItem('TPAV+RISING SLV').baseItem, 'TPAV+SLV')
  assert.equal(parseItem('TPAV+RISING SLV').slot, 3)

  assert.equal(parseItem('SLV METAL').slot, 1)
  assert.equal(parseItem('SLV METAL 9523').baseItem, 'SLV METAL')
  assert.equal(parseItem('SLV METAL 9523').slot, 2)
  assert.equal(parseItem('SLV RISING-METAL').baseItem, 'SLV METAL')
  assert.equal(parseItem('SLV RISING-METAL').slot, 3)
})

test('BFV: plain/DI -> V1, CS -> V2, WAFER -> V3, 9523 -> V4', () => {
  assert.equal(parseItem('BFV').slot, 1)
  assert.equal(parseItem('BFV').variant, 'PLAIN')
  assert.equal(parseItem('BFV-DI').slot, 1)
  assert.equal(parseItem('BFV-DI').variant, 'DI')
  assert.equal(parseItem('BFV-CS').slot, 2)
  assert.equal(parseItem('BFV-CS').variant, 'CS')
  // The live Contract Review sheet spells this variant "BFV CAST STEEL"; it
  // must be treated as the same CS variant as "BFV-CS".
  assert.equal(parseItem('BFV CAST STEEL').slot, 2)
  assert.equal(parseItem('BFV CAST STEEL').variant, 'CS')
  assert.equal(parseItem('BFV CAST STEEL').label, 'CS')
  assert.equal(parseItem('BFV-WAFER').slot, 3)
  assert.equal(parseItem('BFV-WAFER').variant, 'WAFER')
  assert.equal(parseItem('BFV-9523').slot, 4)
  assert.equal(parseItem('BFV-9523').variant, '9523')
})

test('CAST STEEL is only recognised as CS for BFV', () => {
  // "BFV CAST STEEL" reaches V2, but the same spelling on any other item must
  // not be re-classified as a CS variant.
  assert.equal(parseItem('SLV CAST STEEL').baseItem, 'SLV')
  assert.equal(parseItem('SLV CAST STEEL').hasVersionExtras, false)
  assert.equal(parseItem('SLV CAST STEEL').label, 'Base')
  assert.equal(parseItem('NRV CAST STEEL').slot, 1)
  assert.equal(parseItem('NRV CAST STEEL').label, 'Base')
})

test('DPCV: plain/DI -> V1, CS -> V2, 9523 -> V4, spare -> V3', () => {
  assert.equal(parseItem('DPCV').slot, 1)
  assert.equal(parseItem('DPCV').variant, 'PLAIN')
  assert.equal(parseItem('DPCV-DI').slot, 1)
  assert.equal(parseItem('DPCV-DI').variant, 'DI')
  assert.equal(parseItem('DPCV-CS').slot, 2)
  assert.equal(parseItem('DPCV-CS').variant, 'CS')
  assert.equal(parseItem('DPCV-9523').slot, 4)
  assert.equal(parseItem('DPCV-9523').variant, '9523')
  assert.equal(parseItem('DPCV-WAFER').slot, 3)
  assert.equal(parseItem('DPCV-WAFER').variant, 'OTHER')
})

test('NRV: plain/DI -> V1, 9523 -> V4, unmapped suffix -> V2 (spare)', () => {
  assert.equal(parseItem('NRV').slot, 1)
  assert.equal(parseItem('NRV-DI').slot, 1)
  assert.equal(parseItem('NRV-DI').variant, 'DI')
  assert.equal(parseItem('NRV-9523').slot, 4)
  assert.equal(parseItem('NRV-9523').variant, '9523')
  assert.equal(parseItem('NRV-CS').slot, 2)
  assert.equal(parseItem('NRV-CS').variant, 'OTHER')
})

test('TPAV: plain/DI -> V1, 9523 -> V4, unmapped suffix -> V2 (spare)', () => {
  assert.equal(parseItem('TPAV').slot, 1)
  assert.equal(parseItem('TPAV-DI').slot, 1)
  assert.equal(parseItem('TPAV-DI').variant, 'DI')
  assert.equal(parseItem('TPAV-9523').slot, 4)
  assert.equal(parseItem('TPAV-9523').variant, '9523')
})

test('CF/DV/GV/PRV: plain -> V1, unmapped suffix -> V2 (spare)', () => {
  assert.equal(parseItem('CF').slot, 1)
  assert.equal(parseItem('CF').variant, 'PLAIN')
  assert.equal(parseItem('CF CS').slot, 2)
  assert.equal(parseItem('DV DI').slot, 2)
  assert.equal(parseItem('GV WAFER').slot, 2)
  assert.equal(parseItem('PRV 9523').slot, 2)
})

test('RISING + 9523 takes precedence over the other suffixes', () => {
  const result = parseItem('SLV RISING 9523')
  assert.equal(result.slot, 4)
  assert.equal(result.variant, 'RISING_9523')
})

test('is case-insensitive and collapses whitespace', () => {
  const result = parseItem('  slv    rising   9523  ')
  assert.equal(result.baseItem, 'SLV')
  assert.equal(result.slot, 4)
  assert.equal(result.variant, 'RISING_9523')
})

test('longest base item wins (SLV METAL over SLV, TPAV+SLV over TPAV/SLV)', () => {
  assert.equal(parseItem('SLV METAL 9523').baseItem, 'SLV METAL')
  assert.equal(parseItem('TPAV+SLV 9523').baseItem, 'TPAV+SLV')
})

test('handles real-world compound names from Contract Review', () => {
  const tpaRising = parseItem('TPAV+RISING SLV')
  assert.equal(tpaRising.baseItem, 'TPAV+SLV')
  assert.equal(tpaRising.slot, 3)

  const tpaCs = parseItem('TPAV+CS SLV')
  assert.equal(tpaCs.baseItem, 'TPAV+SLV')
  assert.equal(tpaCs.slot, 1)

  const tpaRising9523 = parseItem('TPAV+RISING SLV-9523')
  assert.equal(tpaRising9523.baseItem, 'TPAV+SLV')
  assert.equal(tpaRising9523.slot, 4)

  const slvMetal9523 = parseItem('SLV RISING-METAL-9523-GB BASE')
  assert.equal(slvMetal9523.baseItem, 'SLV METAL')
  assert.equal(slvMetal9523.slot, 4)

  assert.equal(parseItem('SLV METAL-9523').baseItem, 'SLV METAL')
  assert.equal(parseItem('SLV METAL-9523').slot, 2)
})

test('does not misdetect abbreviations inside unrelated names', () => {
  assert.equal(parseItem('KGV-WAFER').baseItem, null)
  assert.equal(parseItem('BALL FLOAT').baseItem, null)
  assert.equal(parseItem('GLOBE VALVE').baseItem, 'GV')
  assert.equal(parseItem('diaphragm valve').baseItem, 'DV')
})

test('returns empty result for null/undefined/empty', () => {
  const empty = {
    baseItem: null,
    slot: null,
    variant: null,
    label: '',
    hasVersionExtras: false,
  }
  assert.deepEqual(parseItem(null), empty)
  assert.deepEqual(parseItem(undefined), empty)
  assert.deepEqual(parseItem(''), empty)
})

test('returns baseItem null for unknown item', () => {
  assert.deepEqual(parseItem('SOMETHING ELSE'), {
    baseItem: null,
    slot: null,
    variant: null,
    label: '',
    hasVersionExtras: false,
  })
})
