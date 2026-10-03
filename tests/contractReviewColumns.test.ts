import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONTRACT_REVIEW_HEADERS,
  CONTRACT_REVIEW_COLUMN_GROUPS,
  CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
  dbContractReviewToRow,
} from '../lib/gmd_lib/contract-review-columns.js'

/**
 * Fields the serializer renders through `.join(", ")`. Every other field is a
 * plain nullable string, so the fixture can stand in for all of them at once by
 * echoing back the property name it was asked for — which makes a mis-ordered
 * cell show up as a name that does not match its header.
 */
const CSV_ARRAY_FIELDS = new Set([
  'offerNumber',
  'inspectionNumber',
  'diDate',
  'orderList',
])

function makeRow(
  overrides: Record<string, string | string[]> = {},
): Parameters<typeof dbContractReviewToRow>[0] {
  const target = { ...overrides } as Record<string, string | string[]>
  return new Proxy(target, {
    get(obj, prop: string) {
      if (prop in obj) return obj[prop]
      // Joined with ", " into one cell, so seed distinct members to keep the
      // rendered value unique and the duplicate check below meaningful.
      if (CSV_ARRAY_FIELDS.has(prop)) return [`a-${prop}`, `b-${prop}`]
      return prop
    },
  }) as unknown as Parameters<typeof dbContractReviewToRow>[0]
}

function rowByHeader(row: unknown[], header: string): unknown {
  const idx = (CONTRACT_REVIEW_HEADERS as readonly string[]).indexOf(header)
  assert.notEqual(idx, -1, `"${header}" is not in CONTRACT_REVIEW_HEADERS`)
  return row[idx]
}

test('the serializer emits exactly one cell per header', () => {
  // The headers array and the row array are maintained by hand in lockstep. A
  // length mismatch means every cell after the shortest one is misaligned.
  const row = dbContractReviewToRow(makeRow())
  assert.equal(row.length, CONTRACT_REVIEW_HEADERS.length)
})

test('headers are unique', () => {
  // indexOf() resolves only the first match, so a duplicate header would make
  // the second column unreachable to every IDX constant and filter.
  const seen = new Set<string>()
  for (const header of CONTRACT_REVIEW_HEADERS) {
    assert.equal(seen.has(header), false, `duplicate header "${header}"`)
    seen.add(header)
  }
})

test('the serializer reads each source field at most once', () => {
  // Two cells reading the same field means one header has no field of its own
  // and another is silently duplicated.
  const row = dbContractReviewToRow(makeRow()) as string[]
  assert.equal(row.length, CONTRACT_REVIEW_HEADERS.length)
  const seen = new Set<string>()
  for (const field of row) {
    assert.equal(seen.has(field), false, `"${field}" is rendered twice`)
    seen.add(field)
  }
})

test('the item identity cluster sits beside ITEM_CODE', () => {
  const row = dbContractReviewToRow(makeRow())
  assert.equal(rowByHeader(row, 'ITEM_CODE'), 'itemCode')
  assert.equal(rowByHeader(row, 'ITEM_NAME'), 'itemName')
  assert.equal(rowByHeader(row, 'PARTY ITEM NAME'), 'partyItemName')

  const base = (CONTRACT_REVIEW_HEADERS as readonly string[]).indexOf('ITEM_CODE')
  assert.equal(CONTRACT_REVIEW_HEADERS[base + 1], 'ITEM_NAME')
  assert.equal(CONTRACT_REVIEW_HEADERS[base + 2], 'PARTY ITEM NAME')
})

test('COST CODE REF follows PN RATING and is not a standalone column', () => {
  const headers = CONTRACT_REVIEW_HEADERS as readonly string[]
  const row = dbContractReviewToRow(makeRow())
  assert.equal(rowByHeader(row, 'COST CODE REF'), 'costCodeRef')

  // It sits next to its group siblings in the array, next to the fields it
  // describes rather than up beside ITEM_CODE where it used to live.
  const pn = headers.indexOf('PN RATING')
  assert.equal(headers[pn + 1], 'COST CODE REF')

  // Being a non-first group child is exactly what makes it render inside the
  // collapsed cell instead of as a column of its own: GMDUpdateTable skips
  // every child except the group's first (groupByChild -> visibleCols).
  const group = CONTRACT_REVIEW_COLUMN_GROUPS.find((g) =>
    g.children.some((c) => c.header === 'COST CODE REF'),
  )
  assert.ok(group, 'COST CODE REF is not a child of any column group')
  assert.equal(group.label, 'Item / Size / PN Rating / Cost Code Ref')
  const childIdx = group.children.findIndex((c) => c.header === 'COST CODE REF')
  assert.ok(childIdx > 0, 'COST CODE REF must not be the group anchor')
  assert.equal(group.children[0].header, 'Item')
  assert.deepEqual(
    group.children.map((c) => c.header),
    ['Item', 'SIZE', 'PN RATING', 'COST CODE REF'],
  )
})

test('spot-checked headers resolve to their own DB field', () => {
  // The positions page.tsx derives its IDX constants from.
  const row = dbContractReviewToRow(makeRow())
  const expected: Record<string, string> = {
    'CONTRACT NO': 'contractNo',
    'DATE OF CONTRACT': 'dateOfContract',
    'PARTY NAME': 'partyNameDump',
    'MC NO': 'mcNo',
    'PO NO': 'poNo',
    RATE: 'rate',
    Item: 'item',
    SIZE: 'size',
    'PN RATING': 'pnRating',
    'PHYSICAL STOCK': 'rmPhysicalStock',
    Actuator: 'actuator',
    'BOM ID': 'bomId',
    'RM AVAIL': 'noUse',
    STATUS: 'status',
    'MC Received/Pending': 'mcReceivedPending',
    'COST FROM QUOTATION': 'costfromQuotation',
    'VA % FROM COST': 'vaPercentfromcost',
    'PROD ORDER NO': 'productionOrderNumber',
    'Upload Drawing': 'diagramUrl',
  }
  for (const [header, field] of Object.entries(expected)) {
    assert.equal(rowByHeader(row, header), field, header)
  }
})

test('the collapsed groups hold their documented anchor positions', () => {
  // The comment above CONTRACT_REVIEW_COLUMN_GROUPS quotes these positions; a
  // column inserted or removed anywhere before a group shifts its anchor.
  const headers = CONTRACT_REVIEW_HEADERS as readonly string[]
  assert.equal(headers.indexOf('CONTRACT NO'), 0)
  assert.equal(headers.indexOf('ITEM_NAME'), 4)
  assert.equal(headers.indexOf('Item'), 33)
  assert.equal(headers.indexOf('Actuator'), 39)
  assert.equal(headers.indexOf('LC/RTGS REF NO'), 43)

  // The anchors are where each group actually renders, so assert them from the
  // group data rather than restating the numbers.
  const anchors = CONTRACT_REVIEW_COLUMN_GROUPS.map(
    (g) => headers.indexOf(g.children[0].header),
  )
  assert.deepEqual(anchors, [0, 4, 33, 39, 43])
})

test('every collapsed group child is a real header', () => {
  // GMDUpdateTable drops a child whose header is missing from `headers` via a
  // headers.includes() check, so a typo here fails silently: the column just
  // never renders and the filter is unreachable.
  for (const group of CONTRACT_REVIEW_COLUMN_GROUPS) {
    for (const child of group.children) {
      assert.ok(
        (CONTRACT_REVIEW_HEADERS as readonly string[]).includes(child.header),
        `group "${group.label}" references unknown header "${child.header}"`,
      )
    }
  }
})

test('a header is claimed by at most one group child', () => {
  // Two groups claiming the same header would collapse both onto one cell, and
  // the second group would render nothing.
  const claimed = new Set<string>()
  for (const group of CONTRACT_REVIEW_COLUMN_GROUPS) {
    for (const child of group.children) {
      assert.equal(
        claimed.has(child.header),
        false,
        `"${child.header}" is a child of more than one group`,
      )
      claimed.add(child.header)
    }
  }
})

test('inline-editable headers all exist and point at a DB field', () => {
  // updateContractReviewFieldAction writes whatever this map returns, so a
  // header mapped to a field that does not exist would fail at write time.
  for (const [header, field] of Object.entries(
    CONTRACT_REVIEW_HEADER_TO_DB_FIELD,
  )) {
    assert.ok(
      (CONTRACT_REVIEW_HEADERS as readonly string[]).includes(header),
      `editable header "${header}" is not in CONTRACT_REVIEW_HEADERS`,
    )
    assert.equal(typeof field, 'string')
  }
})
