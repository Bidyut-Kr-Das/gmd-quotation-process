import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesMulti, enquiryPassesFilters } from '../lib/filterUtils.js'
import { BLANK } from '../components/table/MultiSelectFilter.js'
import type { EnquiryData, FiltersState } from '../lib/types.js'

const baseFilters = {
  globalSearch: '',
  partyNames: [],
  enquiryType: [],
  state: [],
  paymentTerms: [],
  inspection: [],
  pbg: [],
  utility: [],
  orderStatus: [],
  closureStatus: [],
  docketNumber: '',
  enquiryDateFrom: '',
  enquiryDateTo: '',
  itemName: '',
  quantity: '',
  itemType: [],
  itemTypeSearch: '',
  moc: [],
  mocSearch: '',
  size: [],
  pnRating: [],
  operationType: [],
  extension: [],
  bypass: [],
  others: [],
  othersSearch: '',
  productCost: [],
  costRefCode: [],
  costRefCodeSearch: '',
  cost: [],
  stockStatus: '',
  stockQuantity: '',
  availableStock: [],
  rmType: [],
  stockAgainstContract: '',
  discount: '',
  vaPercent: [],
  quotedRate: '',
  quotedRateGst: '',
  itemNameMerge: [],
  itemNameMergeSearch: '',
  totalValue: '',
  itemWiseTotalValue: '',
  validation: [],
  apm: [],
  attachment: '',
  erpItemCode: [],
  erpItemCodeSearch: '',
  bomId: [],
  bomIdSearch: '',
  contractReviewRate: [],
  contractReviewRateSearch: '',
  pdcostValidation: [],
  pdcostValidationSearch: '',
  contractNo: [],
  image: [],
} as unknown as FiltersState

test('Blank filter matches when selectedContractNo is empty array', () => {
  const enquiry = {
    id: 'e1',
    partyName: 'Test Party',
    docketNumber: 'D-001',
    contractNo: ['CN-100', 'CN-200'],
    selectedContractNo: [],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  const result = matchesMulti([BLANK], enquiry.selectedContractNo ?? [])
  assert.equal(result, true)

  const passes = enquiryPassesFilters(enquiry, { ...baseFilters, contractNo: [BLANK] })
  assert.equal(passes, true)
})

test('Blank filter matches when selectedContractNo is undefined or has empty strings', () => {
  const enquiryNoField = {
    id: 'e2',
    partyName: 'Test Party',
    docketNumber: 'D-002',
    contractNo: ['CN-100'],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  assert.equal(matchesMulti([BLANK], (enquiryNoField as any).selectedContractNo ?? []), true)
  assert.equal(enquiryPassesFilters(enquiryNoField, { ...baseFilters, contractNo: [BLANK] }), true)

  const enquiryEmptyStr = {
    ...enquiryNoField,
    selectedContractNo: [''],
  } as unknown as EnquiryData
  assert.equal(matchesMulti([BLANK], enquiryEmptyStr.selectedContractNo ?? []), true)
  assert.equal(enquiryPassesFilters(enquiryEmptyStr, { ...baseFilters, contractNo: [BLANK] }), true)
})

test('Blank filter does NOT match when selectedContractNo has contracts', () => {
  const enquiryWithContracts = {
    id: 'e3',
    partyName: 'Test Party',
    docketNumber: 'D-003',
    contractNo: ['CN-100', 'CN-200'],
    selectedContractNo: ['CN-100'],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  assert.equal(matchesMulti([BLANK], enquiryWithContracts.selectedContractNo ?? []), false)
  assert.equal(enquiryPassesFilters(enquiryWithContracts, { ...baseFilters, contractNo: [BLANK] }), false)
})

test('Specific contract filter matches only when contract is in selectedContractNo', () => {
  const enquiry = {
    id: 'e4',
    partyName: 'Test Party',
    docketNumber: 'D-004',
    contractNo: ['CN-100', 'CN-200', 'CN-300'],
    selectedContractNo: ['CN-100'],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  // Matches CN-100 which is in selectedContractNo
  assert.equal(matchesMulti(['CN-100'], enquiry.selectedContractNo ?? []), true)
  assert.equal(enquiryPassesFilters(enquiry, { ...baseFilters, contractNo: ['CN-100'] }), true)

  // Does NOT match CN-200 (in contractNo candidate list, but NOT in selectedContractNo)
  assert.equal(matchesMulti(['CN-200'], enquiry.selectedContractNo ?? []), false)
  assert.equal(enquiryPassesFilters(enquiry, { ...baseFilters, contractNo: ['CN-200'] }), false)
})

test('Multi-select with BLANK and specific contracts', () => {
  const emptyEnquiry = {
    id: 'e5',
    partyName: 'Test Party',
    docketNumber: 'D-005',
    contractNo: ['CN-100'],
    selectedContractNo: [],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  const matchedEnquiry = {
    id: 'e6',
    partyName: 'Test Party',
    docketNumber: 'D-006',
    contractNo: ['CN-100'],
    selectedContractNo: ['CN-100'],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  const otherEnquiry = {
    id: 'e7',
    partyName: 'Test Party',
    docketNumber: 'D-007',
    contractNo: ['CN-200'],
    selectedContractNo: ['CN-200'],
    enquiryDate: new Date(),
    attachments: [],
    items: [],
  } as unknown as EnquiryData

  const filter = [BLANK, 'CN-100']
  assert.equal(enquiryPassesFilters(emptyEnquiry, { ...baseFilters, contractNo: filter }), true)
  assert.equal(enquiryPassesFilters(matchedEnquiry, { ...baseFilters, contractNo: filter }), true)
  assert.equal(enquiryPassesFilters(otherEnquiry, { ...baseFilters, contractNo: filter }), false)
})
