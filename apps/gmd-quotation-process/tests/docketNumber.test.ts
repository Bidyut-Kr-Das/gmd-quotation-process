import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getFiscalYearLabel,
  getFiscalPrefix,
  parseDocketSerial,
  nextDocketSerials,
} from '../lib/docketNumber.js'

test('fiscal year runs April to March', () => {
  assert.equal(getFiscalYearLabel(new Date(2026, 3, 1)), '2026-27') // April
  assert.equal(getFiscalYearLabel(new Date(2026, 2, 31)), '2025-26') // March
  assert.equal(getFiscalPrefix(new Date(2026, 3, 1)), 'GMD/2026-27/')
})

test('parseDocketSerial reads the trailing number', () => {
  assert.equal(parseDocketSerial('GMD/2026-27/428'), 428)
  assert.equal(parseDocketSerial('GMD/2026-27/007'), 7)
  assert.equal(parseDocketSerial('garbage'), 0)
})

test('nextDocketSerials continues after the highest serial', () => {
  const out = nextDocketSerials(
    ['GMD/2026-27/5', 'GMD/2026-27/12', 'GMD/2026-27/3'],
    3,
    new Date(2026, 3, 1),
  )
  assert.deepEqual(out, ['GMD/2026-27/13', 'GMD/2026-27/14', 'GMD/2026-27/15'])
})

test('nextDocketSerials starts at 1 when none exist', () => {
  assert.deepEqual(nextDocketSerials([], 2, new Date(2026, 3, 1)), [
    'GMD/2026-27/1',
    'GMD/2026-27/2',
  ])
})
