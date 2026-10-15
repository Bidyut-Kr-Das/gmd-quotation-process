import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCostChangeAnchor } from '../lib/rateAnchor.js'

test('default row: VA% is held, Quoted Rate is derived', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: 9999, vaPercent: 20, validation: null })
  assert.equal(out.quotedRate, 1200)
  assert.equal(out.vaPercent, 20)
})

test('default row: Quoted Rate is rounded up to the nearest 10', () => {
  const out = resolveCostChangeAnchor({ cost: 1234, quotedRate: null, vaPercent: 15, validation: null })
  assert.equal(out.quotedRate, 1420) // 1419.1 -> 1420
})

test('default row with blank VA%: falls back to deriving VA% from the rate', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: 1200, vaPercent: null, validation: null })
  assert.equal(out.quotedRate, 1200)
  assert.equal(out.vaPercent, 20)
})

test('validation Yes: Quoted Rate frozen, VA% absorbs the change', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: 1500, vaPercent: 99, validation: 'Yes' })
  assert.equal(out.quotedRate, 1500)
  assert.equal(out.vaPercent, 50)
})

test('validation Yes with no rate: nothing is derived', () => {
  const out = resolveCostChangeAnchor({ cost: 1000, quotedRate: null, vaPercent: 20, validation: 'Yes' })
  assert.equal(out.quotedRate, null)
  assert.equal(out.vaPercent, 20)
})

test('zero or negative cost is a no-op', () => {
  const out = resolveCostChangeAnchor({ cost: 0, quotedRate: 1500, vaPercent: 20, validation: null })
  assert.equal(out.quotedRate, 1500)
  assert.equal(out.vaPercent, 20)
})
