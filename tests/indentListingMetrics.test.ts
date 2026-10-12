import test from 'node:test'
import assert from 'node:assert/strict'
import {
  splitRmCodes,
  buildContractMetricsByRmCode,
  buildStockByRmCode,
  buildVariantMetrics,
  buildRowVariantMetrics,
  type ContractMetricRow,
} from '../lib/indentListingMetrics.js'

function contract(overrides: Partial<ContractMetricRow> = {}): ContractMetricRow {
  return {
    costCodeRef: 'RSD120003',
    mcReceivedPending: 'Received',
    orderQty: '100',
    balanceToProdOrd: '10',
    ...overrides,
  }
}

test('splitRmCodes normalises and drops blanks', () => {
  assert.deepEqual(splitRmCodes(' rsd1 ,, RSD2 '), ['RSD1', 'RSD2'])
  assert.deepEqual(splitRmCodes(null), [])
})

test('MC received/pending split by status and ordered total', () => {
  const map = buildContractMetricsByRmCode([
    contract({ mcReceivedPending: 'Received', orderQty: '100', balanceToProdOrd: '10' }),
    contract({ mcReceivedPending: 'Pending', orderQty: '40', balanceToProdOrd: '25' }),
    contract({ mcReceivedPending: 'pending', orderQty: '60', balanceToProdOrd: '5' }),
  ])

  assert.deepEqual(map.get('RSD120003'), {
    received: 100,
    pending: 100,
    ordered: 200,
    pendingOrder: 40,
  })
})

test('a comma-joined costCodeRef attributes quantities to every code', () => {
  const map = buildContractMetricsByRmCode([
    contract({ costCodeRef: 'AAA, BBB', orderQty: '30', balanceToProdOrd: '3' }),
  ])

  assert.equal(map.get('AAA')?.ordered, 30)
  assert.equal(map.get('BBB')?.ordered, 30)
  assert.equal(map.get('AAA')?.received, 30)
})

test('unknown status still counts toward ordered but not received/pending', () => {
  const map = buildContractMetricsByRmCode([
    contract({ mcReceivedPending: '', orderQty: '12', balanceToProdOrd: '1' }),
  ])

  assert.deepEqual(map.get('RSD120003'), {
    received: 0,
    pending: 0,
    ordered: 12,
    pendingOrder: 1,
  })
})

test('stock keys by ERP code and ignores blanks', () => {
  const map = buildStockByRmCode([
    { erpItemCode: 'RSD1', availableStock: '25' },
    { erpItemCode: 'rsd2', availableStock: '1,000.50' },
    { erpItemCode: '', availableStock: '4' },
    { erpItemCode: 'RSD3', availableStock: '' },
  ])

  assert.equal(map.get('RSD1'), 25)
  assert.equal(map.get('RSD2'), 1000.5)
  assert.equal(map.has('RSD3'), false)
})

test('variant metrics sum across a comma-joined RM code list', () => {
  const stock = new Map([['AAA', 10], ['BBB', 5]])
  const contracts = buildContractMetricsByRmCode([
    contract({ costCodeRef: 'AAA', mcReceivedPending: 'Received', orderQty: '2', balanceToProdOrd: '1' }),
    contract({ costCodeRef: 'BBB', mcReceivedPending: 'Pending', orderQty: '3', balanceToProdOrd: '2' }),
  ])

  assert.deepEqual(buildVariantMetrics('AAA, BBB', stock, contracts), {
    mcReceived: '2',
    mcPending: '3',
    stock: '15',
    orderedQty: '5',
    pendingOrderQty: '3',
  })
})

test('variant metrics are blank when the RM code resolves to nothing', () => {
  assert.deepEqual(
    buildVariantMetrics('NOPE', new Map(), new Map()),
    {
      mcReceived: null,
      mcPending: null,
      stock: null,
      orderedQty: null,
      pendingOrderQty: null,
    },
  )
  assert.deepEqual(buildVariantMetrics(null, new Map(), new Map()), {
    mcReceived: null,
    mcPending: null,
    stock: null,
    orderedQty: null,
    pendingOrderQty: null,
  })
})

test('buildRowVariantMetrics reads rmCodeV1..V4 positions', () => {
  const stock = new Map([['AAA', 7]])
  const contracts = buildContractMetricsByRmCode([
    contract({ costCodeRef: 'AAA', mcReceivedPending: 'Received', orderQty: '9', balanceToProdOrd: '1' }),
  ])
  const row = new Array(17).fill('')
  row[13] = 'AAA'

  const metrics = buildRowVariantMetrics([row], [13, 14, 15, 16], stock, contracts)

  assert.equal(metrics.length, 1)
  assert.equal(metrics[0].length, 4)
  assert.equal(metrics[0][0].stock, '7')
  assert.equal(metrics[0][0].orderedQty, '9')
  assert.equal(metrics[0][1].stock, null)
  assert.equal(metrics[0][3].mcReceived, null)
})
