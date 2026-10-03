import test from 'node:test'
import assert from 'node:assert/strict'
import { planContractPhysicalStock } from '../lib/contractPhysicalStock.js'

test('a single RM code takes the stock-phys value for that code', () => {
  const plan = planContractPhysicalStock(
    [{ id: 'c1', costCodeRef: 'RSD120003' }],
    { RSD120003: '1,234.5' },
  )
  assert.equal(plan.get('c1'), '1234.5')
})

test('a comma-joined ref sums the physical stock of every code', () => {
  const plan = planContractPhysicalStock(
    [{ id: 'c1', costCodeRef: 'AAA111, ZZZ999' }],
    { AAA111: '10', ZZZ999: '2.5' },
  )
  assert.equal(plan.get('c1'), '12.5')
})

test('codes are matched case-insensitively and trimmed', () => {
  const plan = planContractPhysicalStock(
    [{ id: 'c1', costCodeRef: ' rsd120003 , RSD120004 ' }],
    { RSD120003: '5', RSD120004: '7' },
  )
  assert.equal(plan.get('c1'), '12')
})

test('a code missing from the sheet contributes nothing', () => {
  const plan = planContractPhysicalStock(
    [{ id: 'c1', costCodeRef: 'AAA111, NOPE' }],
    { AAA111: '4' },
  )
  assert.equal(plan.get('c1'), '4')
})

test('a blank or unresolvable ref yields null', () => {
  const plan = planContractPhysicalStock(
    [
      { id: 'blank', costCodeRef: '' },
      { id: 'null', costCodeRef: null },
      { id: 'missing', costCodeRef: 'NOPE' },
      { id: 'nonnumeric', costCodeRef: 'AAA111' },
    ],
    { AAA111: 'N/A' },
  )
  assert.equal(plan.get('blank'), null)
  assert.equal(plan.get('null'), null)
  assert.equal(plan.get('missing'), null)
  assert.equal(plan.get('nonnumeric'), null)
})

test('an already-integer total renders without a decimal tail', () => {
  const plan = planContractPhysicalStock(
    [{ id: 'c1', costCodeRef: 'AAA111, BBB222' }],
    { AAA111: '10.25', BBB222: '0.75' },
  )
  assert.equal(plan.get('c1'), '11')
})
