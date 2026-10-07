import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContractReviewImageMap } from '../lib/gmd_lib/contract-review-image-lookup.js'

const image = (
  imageKey: string,
  overrides: Record<string, unknown> = {},
) => ({
  imageKey,
  url: `https://drive.google.com/file/d/${imageKey}/view`,
  driveFileId: imageKey,
  itemType: 'BUTTERFLY VALVE',
  operationType: 'GEAR OP',
  rmType: 'WAFER TYPE',
  ...overrides,
})

test('maps an enquiry item to its image and keys by normalized item code', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
    ],
    [image('butterfly_valve__gear_op__wafer_type')],
  )

  assert.deepEqual(map.get('SD26Y-00052')?.map((i) => i.imageKey), [
    'butterfly_valve__gear_op__wafer_type',
  ])
})

test('item codes differing only in case or spacing still match', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: '  sd26y-00052  ',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
    ],
    [image('butterfly_valve__gear_op__wafer_type')],
  )

  assert.equal(map.get('SD26Y-00052')?.length, 1)
})

test('one item code with two rm types resolves to two images', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'FLANGE TYPE',
      },
    ],
    [
      image('butterfly_valve__gear_op__wafer_type'),
      image('butterfly_valve__gear_op__flange_type', { rmType: 'FLANGE TYPE' }),
    ],
  )

  assert.deepEqual(
    map.get('SD26Y-00052')?.map((i) => i.imageKey).sort(),
    ['butterfly_valve__gear_op__flange_type', 'butterfly_valve__gear_op__wafer_type'],
  )
})

test('repeated image keys across enquiries are de-duplicated', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'butterfly valve',
        operationType: 'gear op',
        rmType: 'wafer type',
      },
    ],
    [image('butterfly_valve__gear_op__wafer_type')],
  )

  assert.equal(map.get('SD26Y-00052')?.length, 1)
})

test('images with neither url nor driveFileId are excluded', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
    ],
    [image('butterfly_valve__gear_op__wafer_type', { url: null, driveFileId: null })],
  )

  assert.equal(map.size, 0)
})

test('enquiry rows missing item type or operation type are skipped', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: 'SD26Y-00052',
        itemType: null,
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: null,
        rmType: 'WAFER TYPE',
      },
    ],
    [image('butterfly_valve__gear_op__wafer_type')],
  )

  assert.equal(map.size, 0)
})

test('rows with a blank item code are ignored', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: '   ',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GEAR OP',
        rmType: 'WAFER TYPE',
      },
    ],
    [image('butterfly_valve__gear_op__wafer_type')],
  )

  assert.equal(map.size, 0)
})

test('operation type part order does not affect the match', () => {
  const map = buildContractReviewImageMap(
    [
      {
        erpItemCode: 'SD26Y-00052',
        itemType: 'BUTTERFLY VALVE',
        operationType: 'GB+ACT',
        rmType: 'WAFER TYPE',
      },
    ],
    [image('butterfly_valve__act+gb__wafer_type', { operationType: 'ACT+GB' })],
  )

  assert.equal(map.get('SD26Y-00052')?.length, 1)
})
