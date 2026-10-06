import test from 'node:test'
import assert from 'node:assert/strict'
import { guardInventedMoc, hasExplicitMocToken } from '../lib/mocGuard.js'

test('hasExplicitMocToken detects rubber/EPDM mentions', () => {
  assert.equal(hasExplicitMocToken('RUBBER', 'EPDM Rubber Gasket 200 MM'), true)
  assert.equal(hasExplicitMocToken('RUBBER', 'Nitrile seat butterfly valve'), true)
  assert.equal(hasExplicitMocToken('RUBBER', 'Resilient Seated Sluice Valve'), false)
  assert.equal(hasExplicitMocToken('WOODEN', 'Wooden crate'), true)
})

test('AI-invented RUBBER on a sluice valve falls back to DUCTILE IRON/CAST IRON', () => {
  const r = guardInventedMoc({
    moc: 'RUBBER',
    mocSource: 'ai',
    itemName: 'SCOUR /RESILIENT SEATED SLUICE VALVESIZE80 MM',
    itemType: 'SLUICE VALVE-RESILIENT-NON-RISING',
  })
  assert.deepEqual(r, { moc: 'DUCTILE IRON/CAST IRON', mocSource: 'keyword' })
})

test('AI-invented RUBBER on a non-sluice item is blanked', () => {
  const r = guardInventedMoc({
    moc: 'RUBBER',
    mocSource: 'ai',
    itemName: 'Air Valve 50 mm',
    itemType: 'TPAV',
  })
  assert.deepEqual(r, { moc: null, mocSource: null })
})

test('explicit rubber token is kept', () => {
  const r = guardInventedMoc({
    moc: 'RUBBER',
    mocSource: 'ai',
    itemName: 'EPDM Rubber Gasket 150 MM',
    itemType: 'GASKET',
  })
  assert.deepEqual(r, { moc: 'RUBBER', mocSource: 'ai' })
})

test('keyword and sheet sourced MOC is never touched', () => {
  assert.deepEqual(
    guardInventedMoc({ moc: 'MILD STEEL', mocSource: 'keyword', itemName: 'MS Flange', itemType: 'FLANGE' }),
    { moc: 'MILD STEEL', mocSource: 'keyword' },
  )
  assert.deepEqual(
    guardInventedMoc({ moc: 'RUBBER', mocSource: 'sheet', itemName: 'air valve', itemType: 'TPAV' }),
    { moc: 'RUBBER', mocSource: 'sheet' },
  )
})

test('non-component materials and blank MOC are untouched', () => {
  assert.deepEqual(
    guardInventedMoc({ moc: 'STAINLESS STEEL', mocSource: 'ai', itemName: 'some valve', itemType: 'BALL VALVE' }),
    { moc: 'STAINLESS STEEL', mocSource: 'ai' },
  )
  assert.deepEqual(
    guardInventedMoc({ moc: null, mocSource: null, itemName: 'some valve', itemType: 'BALL VALVE' }),
    { moc: null, mocSource: null },
  )
})
