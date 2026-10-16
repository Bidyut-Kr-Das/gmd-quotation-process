import test from 'node:test'
import assert from 'node:assert/strict'
import { makeImageKey, rmTypeForPrompt } from '../lib/imageKey.js'

test('makeImageKey builds a normalized key from normal input', () => {
  assert.equal(
    makeImageKey('BUTTERFLY VALVE', 'GEAR OP', 'WAFER TYPE'),
    'butterfly_valve__gear_op__wafer_type',
  )
})

test('makeImageKey is case-insensitive', () => {
  assert.equal(
    makeImageKey('Butterfly Valve', 'Gear Op', 'Wafer Type'),
    makeImageKey('BUTTERFLY VALVE', 'GEAR OP', 'WAFER TYPE'),
  )
})

test('makeImageKey sorts operationType parts so reordered parts match', () => {
  assert.equal(
    makeImageKey('Butterfly Valve', 'GB+ACT', 'WAFER TYPE'),
    makeImageKey('Butterfly Valve', 'ACT+GB', 'WAFER TYPE'),
  )
  assert.equal(
    makeImageKey('Butterfly Valve', 'GB+ACT', 'WAFER TYPE'),
    'butterfly_valve__act+gb__wafer_type',
  )
})

test('makeImageKey collapses extra whitespace', () => {
  assert.equal(
    makeImageKey('  Butterfly   Valve ', ' GEAR   OP ', '  WAFER   TYPE  '),
    'butterfly_valve__gear_op__wafer_type',
  )
})

test('makeImageKey trims whitespace around "+" parts before sorting', () => {
  assert.equal(
    makeImageKey('Butterfly Valve', ' GB + ACT ', 'WAFER TYPE'),
    'butterfly_valve__act+gb__wafer_type',
  )
})

test('makeImageKey handles empty and nullish parts', () => {
  assert.equal(makeImageKey('', '', ''), '____')
  assert.equal(
    makeImageKey(null as unknown as string, null as unknown as string, null as unknown as string),
    '____',
  )
})

test('rmTypeForPrompt maps flange standards to FLANGE TYPE', () => {
  assert.equal(rmTypeForPrompt('1538'), 'FLANGE TYPE')
  assert.equal(rmTypeForPrompt('9523'), 'FLANGE TYPE')
  assert.equal(rmTypeForPrompt('ansi'), 'FLANGE TYPE')
  assert.equal(rmTypeForPrompt('ANSI'), 'FLANGE TYPE')
  assert.equal(rmTypeForPrompt('Common'), 'FLANGE TYPE')
  assert.equal(rmTypeForPrompt('  1538  '), 'FLANGE TYPE')
})

test('rmTypeForPrompt passes through other values unchanged', () => {
  assert.equal(rmTypeForPrompt('WAFER TYPE'), 'WAFER TYPE')
  assert.equal(rmTypeForPrompt('GB SPUR'), 'GB SPUR')
})

test('rmTypeForPrompt handles null and empty', () => {
  assert.equal(rmTypeForPrompt(null), '')
  assert.equal(rmTypeForPrompt(undefined), '')
  assert.equal(rmTypeForPrompt(''), '')
})
