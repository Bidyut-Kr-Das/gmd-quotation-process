import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveImportedInhouse } from '../lib/importInhouseMapping.js'

test('all-size rules resolve by canonical itemType', () => {
  assert.equal(resolveImportedInhouse('GLOBE VALVE', '100'), 'IMPORT')
  assert.equal(resolveImportedInhouse('CHECK VALVE', '100'), 'IMPORT')
  assert.equal(resolveImportedInhouse('BALL VALVE', '500'), 'DOMESTIC')
  assert.equal(resolveImportedInhouse('SLUICE VALVE-RESILIENT-RISING', '300'), 'IMPORT')
  assert.equal(resolveImportedInhouse('DPCV', '100'), 'DOMESTIC')
  assert.equal(resolveImportedInhouse('GASKET', '50'), 'DOMESTIC')
})

test('butterfly valve is size dependent', () => {
  assert.equal(resolveImportedInhouse('BUTTERFLY VALVE', '50'), 'IMPORT')
  assert.equal(resolveImportedInhouse('BUTTERFLY VALVE', '450'), 'IMPORT')
  assert.equal(resolveImportedInhouse('BUTTERFLY VALVE', '500'), 'INHOUSE')
  assert.equal(resolveImportedInhouse('BUTTERFLY VALVE', '1200'), 'INHOUSE')
  assert.equal(resolveImportedInhouse('BUTTERFLY VALVE', null), null)
})

test('aliases map sheet-only names to canonical types', () => {
  assert.equal(resolveImportedInhouse('BUSH PLATE', '100'), 'IMPORT')
  assert.equal(resolveImportedInhouse('CUSHION', '100'), 'IMPORT')
})

test('blank/unknown types resolve to null', () => {
  assert.equal(resolveImportedInhouse('RETAINER RING', '100'), null)
  assert.equal(resolveImportedInhouse('PLUG VALVE', '100'), null)
  assert.equal(resolveImportedInhouse('COTTER PIN', '100'), null)
  assert.equal(resolveImportedInhouse('CABLE', '100'), null)
  assert.equal(resolveImportedInhouse('UNKNOWN TYPE', '100'), null)
  assert.equal(resolveImportedInhouse(null, '100'), null)
})

test('falls back to itemName when itemType is missing or unknown', () => {
  assert.equal(resolveImportedInhouse(null, '500', '500mm butterfly valve'), 'INHOUSE')
  assert.equal(resolveImportedInhouse('UNKNOWN TYPE', '100', 'ball valve 100mm'), 'DOMESTIC')
  assert.equal(resolveImportedInhouse('', '100', 'globe valve DN100'), 'IMPORT')
})

test('is case and whitespace insensitive on itemType', () => {
  assert.equal(resolveImportedInhouse('  ball   valve ', '100'), 'DOMESTIC')
  assert.equal(resolveImportedInhouse('globe valve', '100'), 'IMPORT')
})
