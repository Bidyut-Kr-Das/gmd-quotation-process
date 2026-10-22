import test from 'node:test'
import assert from 'node:assert/strict'
import {
  toNumber,
  computeDeliverySchedule,
  DEFAULT_DELIVERY_SCHEDULE,
} from '../lib/deliverySchedule.js'

test('toNumber parses numbers with commas, spaces and decimals', () => {
  assert.equal(toNumber('1,000'), 1000)
  assert.equal(toNumber('  42  '), 42)
  assert.equal(toNumber('254.5'), 254.5)
  assert.equal(toNumber(42), 42)
  assert.equal(toNumber(null), null)
  assert.equal(toNumber(undefined), null)
  assert.equal(toNumber(''), null)
  assert.equal(toNumber('abc'), null)
})

test('in stock returns 2-3 weeks (size <= 1200 or missing)', () => {
  assert.equal(computeDeliverySchedule(2, '42'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(2, '2'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(0, '0'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule('100', '1,000'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(2, '42', '500'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(2, '42', '1200'), DEFAULT_DELIVERY_SCHEDULE)
})

test('in stock with size > 1200 returns 2 months', () => {
  assert.equal(computeDeliverySchedule(2, '42', '1300'), '2 months')
  assert.equal(computeDeliverySchedule(2, '42', '2400'), '2 months')
})

test('out of stock, size <= 500 returns 2 months regardless of classification', () => {
  assert.equal(computeDeliverySchedule(6, '0', '500'), '2 months')
  assert.equal(computeDeliverySchedule(6, '0', '450'), '2 months')
  assert.equal(computeDeliverySchedule(340, '42', '100', 'IMPORT'), '2 months')
  assert.equal(computeDeliverySchedule(340, '42', '100', 'INHOUSE'), '2 months')
})

test('out of stock, 500 < size <= 1200 depends on import/in-house', () => {
  assert.equal(computeDeliverySchedule(6, '0', '600', 'IMPORT'), '2 months')
  assert.equal(computeDeliverySchedule(6, '0', '1200', 'IMPORT'), '2 months')
  assert.equal(computeDeliverySchedule(6, '0', '600', 'INHOUSE'), '3 months')
  assert.equal(computeDeliverySchedule(6, '0', '1200', 'DOMESTIC'), '3 months')
  assert.equal(computeDeliverySchedule(6, '0', '600', 'domestic'), '3 months')
})

test('out of stock, mid band with blank/unknown classification falls back to 2-3 weeks', () => {
  assert.equal(computeDeliverySchedule(6, '0', '600', null), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(6, '0', '600', ''), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(6, '0', '600', 'N/A'), DEFAULT_DELIVERY_SCHEDULE)
})

test('out of stock, size > 1200 returns Min. 3 to 4 months', () => {
  assert.equal(computeDeliverySchedule(6, '0', '1300'), 'Min. 3 to 4 months')
  assert.equal(computeDeliverySchedule(6, '0', '2400', 'IMPORT'), 'Min. 3 to 4 months')
})

test('out of stock, missing size falls back to 2-3 weeks', () => {
  assert.equal(computeDeliverySchedule(6, '0'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(6, '0', null, 'IMPORT'), DEFAULT_DELIVERY_SCHEDULE)
  assert.equal(computeDeliverySchedule(6, '0', '', null), DEFAULT_DELIVERY_SCHEDULE)
})

test('delivery schedule stays null when quantity or available stock is missing', () => {
  assert.equal(computeDeliverySchedule(10, null), null)
  assert.equal(computeDeliverySchedule(null, '10'), null)
  assert.equal(computeDeliverySchedule(undefined, undefined), null)
  assert.equal(computeDeliverySchedule(10, ''), null)
  assert.equal(computeDeliverySchedule('', '10'), null)
})

test('delivery schedule stays null when available stock is not numeric', () => {
  assert.equal(computeDeliverySchedule(10, 'abc'), null)
  assert.equal(computeDeliverySchedule(10, 'N/A'), null)
})
