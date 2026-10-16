import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
} from '../lib/gmd_lib/sheet-columns.js'
import { dbItemToRow, sheetRowToDbItem } from '../lib/gmd_lib/mapSheetRow.js'

// The L1..L8 block must read sequentially. It starts at index 2 because the
// first two canonical columns are the ERP code and the auto item name.
const L_BLOCK_START = 2
const EXPECTED_L_HEADERS = [
  'L1',
  'L2-VALVE TYPE',
  'L3-DIA',
  'L4-COMPONENT',
  'L5- MATERIAL',
  'L6-STD',
  'L7-DIMENSION',
  'L8 -ITEM CATEGORY',
]
const EXPECTED_L_FIELDS = [
  'l1',
  'l2ValveType',
  'l3Dia',
  'l4Component',
  'l5Material',
  'l6Std',
  'l7Dimension',
  'l8ItemCategory',
]

// Echoes the property name for every field so a mis-ordered cell shows up as a
// name that does not match its header.
function makeItem(): Parameters<typeof dbItemToRow>[0] {
  return new Proxy({} as Record<string, string>, {
    get(_obj, prop: string) {
      return prop
    },
  }) as unknown as Parameters<typeof dbItemToRow>[0]
}

test('L1..L8 sit in sequence in CANONICAL_COLUMNS', () => {
  assert.deepEqual(
    CANONICAL_COLUMNS.slice(L_BLOCK_START, L_BLOCK_START + 8),
    EXPECTED_L_HEADERS,
  )
})

test('each canonical column maps to its own DB field', () => {
  const fields = CANONICAL_COLUMNS.map(
    (_, i) => COL_INDEX_TO_DB_FIELD[i],
  )
  for (const field of fields) {
    assert.ok(field, 'every canonical column must map to a DB field')
  }
  assert.equal(new Set(fields).size, fields.length, 'fields must be unique')
})

test('the L columns map to the sequential L fields', () => {
  EXPECTED_L_FIELDS.forEach((field, i) => {
    assert.equal(COL_INDEX_TO_DB_FIELD[L_BLOCK_START + i], field)
  })
})

test('dbItemToRow emits the L block in L1..L8 order', () => {
  const row = dbItemToRow(makeItem())
  // The canonical block is followed by Bom ID, Vendor Reference and Attachment.
  assert.equal(row.length, CANONICAL_COLUMNS.length + 3)
  assert.deepEqual(row.slice(L_BLOCK_START, L_BLOCK_START + 8), EXPECTED_L_FIELDS)
})

test('sheetRowToDbItem reads L1..L8 from their canonical positions', () => {
  const row = new Array(CANONICAL_COLUMNS.length).fill('')
  EXPECTED_L_HEADERS.forEach((_, i) => {
    row[L_BLOCK_START + i] = `mark-${i + 1}`
  })

  const db = sheetRowToDbItem(row, new Date())
  EXPECTED_L_FIELDS.forEach((field, i) => {
    assert.equal(
      (db as Record<string, unknown>)[field],
      `mark-${i + 1}`,
      `${field} should read canonical index ${L_BLOCK_START + i}`,
    )
  })
})
