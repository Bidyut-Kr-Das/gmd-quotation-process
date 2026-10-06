import test from 'node:test'
import assert from 'node:assert/strict'
import { matchItemType, matchMoc, ITEM_TYPE_PATTERNS, MOC_PATTERNS, correctItemType } from '../lib/itemTypePatterns.js'

test('matchItemType detects butterfly valve', () => {
  assert.equal(matchItemType('D.I. Double Flanged Butter Fly Valve 1800mm PN16'), 'BUTTERFLY VALVE')
})

test('matchItemType detects butterfly valve compact form', () => {
  assert.equal(matchItemType('Butterfly Valve DN200'), 'BUTTERFLY VALVE')
})

test('matchItemType does NOT return companion flange for butterfly valve', () => {
  const result = matchItemType('D.I. Double Flanged Butter Fly Valve 1800mm PN16')
  assert.notEqual(result, 'COMPANION FLANGE')
})

test('matchItemType detects sluice valve', () => {
  assert.equal(matchItemType('CI Sluice Valve 200mm'), 'SLUICE VALVE-METAL-NON-RISING')
})

test('matchItemType detects resilient seated sluice valve', () => {
  assert.equal(matchItemType('150 mm DI DF Resilient seated type Sluice Valve of PN 1.0 Mpa'), 'SLUICE VALVE-RESILIENT-NON-RISING')
})

test('matchItemType maps gate valve to sluice valve resilient rising', () => {
  assert.equal(matchItemType('Gate Valve 150mm PN16'), 'SLUICE VALVE-RESILIENT-RISING')
})

test('matchItemType detects ball valve', () => {
  assert.equal(matchItemType('Ball Valve 50mm SS304'), 'BALL VALVE')
})

test('matchItemType detects globe valve', () => {
  assert.equal(matchItemType('Globe Valve 80mm'), 'GLOBE VALVE')
})

test('matchItemType detects check valve', () => {
  assert.equal(matchItemType('Non Return Valve 100mm'), 'CHECK VALVE')
})

test('matchItemType prioritises DPCV over check valve for dual plate names', () => {
  assert.equal(matchItemType('Dual Plate Check Valve 100mm'), 'DPCV')
  assert.equal(matchItemType('DUAL-PLATE CHECK VALVE'), 'DPCV')
  assert.equal(matchItemType('Dualplate check valve DN80'), 'DPCV')
  assert.equal(matchItemType('Dual Plate Non Return Valve'), 'DPCV')
  assert.equal(matchItemType('DPCV 100mm'), 'DPCV')
})

test('correctItemType fixes a CHECK VALVE stored for a dual plate name', () => {
  assert.equal(correctItemType('Dual Plate Check Valve 100mm', 'CHECK VALVE'), 'DPCV')
  assert.equal(correctItemType('Dual-Plate Check Valve', 'check valve'), 'DPCV')
  // Nothing to correct.
  assert.equal(correctItemType('Non Return Valve 100mm', 'CHECK VALVE'), null)
  assert.equal(correctItemType('Dual Plate Check Valve', 'DPCV'), null)
  assert.equal(correctItemType('Dual Plate Check Valve', null), null)
  assert.equal(correctItemType('Random text', 'CHECK VALVE'), null)
})

test('matchItemType detects companion flange', () => {
  assert.equal(matchItemType('Companion Flange 1800mm'), 'COMPANION FLANGE')
})

test('matchItemType detects dismantling joint', () => {
  assert.equal(matchItemType('Dismantling Joint DN300'), 'DISMANTLING JOINT')
})

test('matchItemType detects gasket', () => {
  assert.equal(matchItemType('Gasket 1/2 inch'), 'GASKET')
})

test('matchItemType detects TPAV', () => {
  assert.equal(matchItemType('TPAV 25mm'), 'TPAV')
})

test('matchItemType prioritises TPAV over sluice valve', () => {
  assert.equal(matchItemType('TPAV Sluice valve 200mm,PN1.6'), 'TPAV')
})

test('matchItemType keeps knife gate valve distinct from gate/sluice valve', () => {
  assert.equal(matchItemType('Knife Gate Valve 200mm'), 'KNIFE GATE VALVE')
})

test('matchItemType returns null for unknown', () => {
  assert.equal(matchItemType('Some random text'), null)
})

test('matchItemType returns null for null/undefined', () => {
  assert.equal(matchItemType(null), null)
  assert.equal(matchItemType(undefined), null)
})

test('matchMoc detects ductile iron (D.I.)', () => {
  assert.equal(matchMoc('D.I. Double Flanged Butter Fly Valve'), 'DUCTILE IRON/CAST IRON')
})

test('matchMoc detects ductile iron spelled out', () => {
  assert.equal(matchMoc('Ductile Iron Gate Valve'), 'DUCTILE IRON/CAST IRON')
})

test('matchMoc detects stainless steel', () => {
  assert.equal(matchMoc('SS 304 Ball Valve'), 'STAINLESS STEEL')
})

test('matchMoc detects stainless steel spelled out', () => {
  assert.equal(matchMoc('Stainless Steel Pipe'), 'STAINLESS STEEL')
})

test('matchMoc detects cast iron', () => {
  assert.equal(matchMoc('C.I. Gate Valve'), 'DUCTILE IRON/CAST IRON')
})

test('matchMoc detects mild steel', () => {
  assert.equal(matchMoc('M.S. Flange'), 'MILD STEEL')
})

test('matchMoc detects galvanised iron', () => {
  assert.equal(matchMoc('G.I. Pipe'), 'GALVANISED')
})

test('matchMoc detects pvc', () => {
  assert.equal(matchMoc('PVC Pipe 50mm'), 'PVC')
})

test('matchMoc detects hdpe', () => {
  assert.equal(matchMoc('HDPE Pipe 32mm'), 'HDPE')
})

test('matchMoc detects rubber', () => {
  assert.equal(matchMoc('EPDM Gasket'), 'RUBBER')
})

test('matchMoc returns null for unknown', () => {
  assert.equal(matchMoc('Some random text'), null)
})

test('matchMoc returns null for null/undefined', () => {
  assert.equal(matchMoc(null), null)
  assert.equal(matchMoc(undefined), null)
})

test('matchItemType detects air cushion valve', () => {
  assert.equal(matchItemType('Air Cushion Valve with Cast Iron Body 200 MM Size'), 'AIR CUSHION VALVE')
})

test('matchItemType maps GV abbreviation to sluice valve resilient rising', () => {
  assert.equal(matchItemType('GV200mmPN16CI'), 'SLUICE VALVE-RESILIENT-RISING')
})

test('matchItemType detects butterfly valve via BFV abbreviation', () => {
  assert.equal(matchItemType('BFV 150mm PN16'), 'BUTTERFLY VALVE')
})

test('matchItemType detects globe valve via GLV abbreviation', () => {
  assert.equal(matchItemType('GLV 80mm'), 'GLOBE VALVE')
})

test('matchItemType detects check valve via NRV abbreviation', () => {
  assert.equal(matchItemType('NRV50mmPN16CI'), 'CHECK VALVE')
})

test('matchItemType detects check valve via CV abbreviation', () => {
  assert.equal(matchItemType('CV 100mm'), 'CHECK VALVE')
})

test('matchItemType detects ball valve via BV abbreviation', () => {
  assert.equal(matchItemType('BV 50mm'), 'BALL VALVE')
})

test('full scenario: butterfly valve item classifies correctly', () => {
  const itemName = 'D.I. Double Flanged Butter Fly Valve 1800mm PN16'
  assert.equal(matchItemType(itemName), 'BUTTERFLY VALVE')
  assert.equal(matchMoc(itemName), 'DUCTILE IRON/CAST IRON')
})

test('air valve family maps to TPAV', () => {
  assert.equal(matchItemType('DI AIR VALVE 50mm,PN10'), 'TPAV')
  assert.equal(matchItemType('Air Valve 80 mm'), 'TPAV')
  assert.equal(matchItemType('AIR RELEASE VALVE 80MM'), 'TPAV')
  assert.equal(matchItemType('kinetic air valve 20mm'), 'TPAV')
  assert.equal(matchItemType('kinetic double orifice type air valve 50mm'), 'TPAV')
  assert.equal(
    matchItemType('AIR VALVE WITH ISOLATION SLUICE VALVE NOMINAL DIA (MM)80PN 16'),
    'TPAV',
  )
  assert.equal(matchItemType('Tamper Proof Air Valve With Isolation Sluice Valve'), 'TPAV')
})

test('air cushion valve stays its own category', () => {
  assert.equal(
    matchItemType('Air Cushion Valve with Cast Iron Body 200 MM Size'),
    'AIR CUSHION VALVE',
  )
})

test('air valve word boundary does not match repair valve', () => {
  assert.notEqual(matchItemType('Repair Valve 50mm'), 'TPAV')
})

test('correctItemType forces TPAV for any air-valve name with a wrong stored type', () => {
  // Tamper-proof air valve is stored as a sluice valve: replace with TPAV.
  assert.equal(
    correctItemType('Tampered Proof Air Valve 50mm', 'SLUICE VALVE-RESILIENT-NON-RISING'),
    'TPAV',
  )
  assert.equal(correctItemType('AIR VALVE 50mm', 'AIR VALVE'), 'TPAV')
  assert.equal(correctItemType('Air Release Valve 80mm', 'AIR VALVE'), 'TPAV')
  assert.equal(correctItemType('kinetic air valve 20mm', 'SLUICE VALVE-METAL-RISING'), 'TPAV')
  assert.equal(
    correctItemType(
      'AIR VALVE WITH ISOLATION SLUICE VALVE NOMINAL DIA (MM)80PN 16',
      'SLUICE VALVE-METAL-RISING',
    ),
    'TPAV',
  )
  // Nothing to correct.
  assert.equal(correctItemType('Air Valve 80mm', 'TPAV'), null)
  // Air cushion valve stays its own category.
  assert.equal(
    correctItemType('Air Cushion Valve with Cast Iron Body 200 MM Size', 'AIR CUSHION VALVE'),
    null,
  )
  // Not an air valve.
  assert.equal(correctItemType('Repair Valve 50mm', 'SLUICE VALVE-RESILIENT-NON-RISING'), null)
})
