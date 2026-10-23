import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planDeliveryScheduleUpdates,
  type DeliveryScheduleSourceItem,
} from '../lib/deliveryScheduleSync.js'
import { DEFAULT_DELIVERY_SCHEDULE } from '../lib/deliverySchedule.js'

function item(over: Partial<DeliveryScheduleSourceItem> = {}): DeliveryScheduleSourceItem {
  return {
    id: 'i1',
    quantity: 6,
    availableStock: '0',
    size: '600',
    itemType: null,
    itemName: 'Gate Valve',
    rmItemCode: null,
    importedInhouse: 'INHOUSE',
    deliverySchedule: null,
    deliveryScheduleOverride: false,
    ...over,
  }
}

test('derived row gets the computed schedule', () => {
  const { updates, noStockDefaulted } = planDeliveryScheduleUpdates([item()], new Map())
  assert.deepEqual(updates, [{ id: 'i1', deliverySchedule: '3 months' }])
  assert.equal(noStockDefaulted, 0)
})

test('a hand-picked value is never overwritten', () => {
  const { updates } = planDeliveryScheduleUpdates(
    [item({ deliveryScheduleOverride: true, deliverySchedule: '6 weeks' })],
    new Map()
  )
  assert.deepEqual(updates, [])
})

test('a hand-picked value still mirrors RM stock', () => {
  const { updates } = planDeliveryScheduleUpdates(
    [item({ deliveryScheduleOverride: true, deliverySchedule: '6 weeks', rmItemCode: 'RM1' })],
    new Map([['RM1', '5']])
  )
  assert.deepEqual(updates, [{ id: 'i1', availableStock: '5' }])
})

test('no write when the stored schedule already matches', () => {
  const { updates } = planDeliveryScheduleUpdates(
    [item({ deliverySchedule: '3 months' })],
    new Map()
  )
  assert.deepEqual(updates, [])
})

test('unknown stock falls back to the default schedule', () => {
  const { updates, noStockDefaulted } = planDeliveryScheduleUpdates(
    [item({ availableStock: null })],
    new Map()
  )
  assert.deepEqual(updates, [{ id: 'i1', deliverySchedule: DEFAULT_DELIVERY_SCHEDULE }])
  assert.equal(noStockDefaulted, 1)
})

test('unknown quantity falls back to the default schedule', () => {
  const { updates, noStockDefaulted } = planDeliveryScheduleUpdates(
    [item({ quantity: 'abc' })],
    new Map()
  )
  assert.deepEqual(updates, [{ id: 'i1', deliverySchedule: DEFAULT_DELIVERY_SCHEDULE }])
  assert.equal(noStockDefaulted, 1)
})

test('RM stock wins over the stored item snapshot and "0" is a real count', () => {
  const { updates } = planDeliveryScheduleUpdates(
    [item({ availableStock: '40', size: '450', rmItemCode: 'rm1' })],
    new Map([['RM1', '0']])
  )
  assert.deepEqual(updates, [{ id: 'i1', availableStock: '0', deliverySchedule: '2 months' }])
})

test('a missing RM value never clears the stored stock', () => {
  const { updates } = planDeliveryScheduleUpdates(
    [item({ availableStock: '7', deliverySchedule: DEFAULT_DELIVERY_SCHEDULE })],
    new Map()
  )
  assert.deepEqual(updates, [])
})
