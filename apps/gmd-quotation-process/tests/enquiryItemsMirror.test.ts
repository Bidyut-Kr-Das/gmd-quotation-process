import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStore } from '../lib/store.js'
import {
  hydrateFromServer,
  updateItemField,
  selectAllEnquiries,
  selectAllItems,
} from '../lib/enquiriesSlice.js'
import type { EnquiryData, EnquiryItemData } from '../lib/types.js'

// enquiriesSlice stores every item twice: once in the items entity adapter and once inside
// its parent enquiry.items. The offer-PDF cell reads enquiry.items instead of subscribing to
// the adapter, so if a future item-mutating reducer forgets the mirror the PDF goes stale.

const item = {
  id: 'i1',
  enquiryId: 'e1',
  position: 0,
  itemName: 'Butterfly Valve DN200',
  quantity: 2,
  quotedRate: '100',
} as unknown as EnquiryItemData

const enquiry = {
  id: 'e1',
  docketNumber: 'GMD/2025-26/1',
  partyName: 'Reliance Infra Ltd',
  createdAt: new Date('2025-01-01'),
  items: [item],
  attachments: [],
} as unknown as EnquiryData

test('updateItemField keeps enquiry.items in sync with the items adapter', () => {
  const store = makeStore()
  store.dispatch(hydrateFromServer({ enquiries: [enquiry], items: [item] }))

  const updated = { ...item, quotedRate: '250' }
  store.dispatch({ type: updateItemField.fulfilled.type, payload: updated })

  const state = store.getState()
  const fromAdapter = selectAllItems(state).find((i) => i.id === 'i1')
  const fromEnquiry = selectAllEnquiries(state)
    .find((e) => e.id === 'e1')!
    .items.find((i) => i.id === 'i1')

  assert.equal(fromAdapter?.quotedRate, '250')
  assert.deepEqual(fromEnquiry, fromAdapter)
})
