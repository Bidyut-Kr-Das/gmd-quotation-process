import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeContractKey } from '../lib/gmd_lib/contract-review-enquiry-backfill.js'

test('normalizeContractKey handles spaces, casing, null, and symbols', () => {
  assert.equal(normalizeContractKey('  sd26y-00052  '), 'SD26Y-00052')
  assert.equal(normalizeContractKey('SD26Y   00052'), 'SD26Y 00052')
  assert.equal(normalizeContractKey(null), '')
  assert.equal(normalizeContractKey(undefined), '')
  assert.equal(normalizeContractKey(''), '')
})

test('byContract map only includes contracts from selectedContractNo, resolving conflicts by recency', () => {
  const enquiries = [
    {
      id: 'e-newer',
      partyName: 'Kalpataru',
      contractNo: ['SD26Y-00062', 'SD26Y-00099'], // SD26Y-00099 is in candidate list but NOT selected
      selectedContractNo: ['SD26Y-00062'],
      state: 'UTTAR PRADESH',
      utility: 'POWER GRID',
      projectReference: 'PR-NEWER',
      enquiryDate: new Date('2026-09-10'),
      createdAt: new Date('2026-09-10'),
    },
    {
      id: 'e-older',
      partyName: 'Kalpataru',
      contractNo: ['SD26Y-00062'],
      selectedContractNo: ['SD26Y-00062'],
      state: 'OLD STATE',
      utility: 'OLD UTILITY',
      projectReference: 'PR-OLDER',
      enquiryDate: new Date('2026-08-01'),
      createdAt: new Date('2026-08-01'),
    },
    {
      id: 'e-empty',
      partyName: 'Reliance',
      contractNo: ['SD26Y-00050'], // Candidate contract, none selected
      selectedContractNo: [],
      state: 'MAHARASHTRA',
      utility: 'MSEDCL',
      projectReference: 'PR-RELIANCE',
      enquiryDate: new Date('2026-09-12'),
      createdAt: new Date('2026-09-12'),
    },
  ]

  // Enquiries sorted desc by enquiryDate
  const sorted = [...enquiries].sort((a, b) => b.enquiryDate.getTime() - a.enquiryDate.getTime())

  const byContract = new Map<string, { state: string | null; utility: string | null; projectReference: string | null }>()
  for (const eq of sorted) {
    for (const cn of eq.selectedContractNo ?? []) {
      const key = normalizeContractKey(cn)
      if (!key || byContract.has(key)) continue
      byContract.set(key, {
        state: eq.state ?? null,
        utility: eq.utility ?? null,
        projectReference: eq.projectReference ?? null,
      })
    }
  }

  // 1. Contract SD26Y-00062 should have values from the newer enquiry (UTTAR PRADESH, POWER GRID, PR-NEWER)
  const matchNewer = byContract.get('SD26Y-00062')
  assert.ok(matchNewer)
  assert.equal(matchNewer.state, 'UTTAR PRADESH')
  assert.equal(matchNewer.utility, 'POWER GRID')
  assert.equal(matchNewer.projectReference, 'PR-NEWER')

  // 2. Candidate contract SD26Y-00099 must NOT be in byContract (was not in selectedContractNo)
  assert.equal(byContract.has('SD26Y-00099'), false)

  // 3. Candidate contract SD26Y-00050 from enquiry with empty selectedContractNo must NOT be in byContract
  assert.equal(byContract.has('SD26Y-00050'), false)
})

test('matching review rows sets values when selected, and clears (null) when unselected', () => {
  const byContract = new Map<string, { state: string | null; utility: string | null; projectReference: string | null }>([
    ['SD26Y-00062', { state: 'UTTAR PRADESH', utility: 'POWER GRID', projectReference: 'PR-001' }],
  ])

  const reviewRows = [
    {
      id: 'cr-1',
      contractNo: 'SD26Y-00062',
      state: null,
      utility: null,
      projectReference: null,
    },
    {
      id: 'cr-2-stale',
      contractNo: 'SD24Y-00010', // Not in selectedContractNo, but previously had stale values from candidate match
      state: 'OLD GUJARAT',
      utility: 'OLD GETCO',
      projectReference: 'OLD-PR',
    },
    {
      id: 'cr-3-already-clean',
      contractNo: 'SD24Y-00020', // Not in selectedContractNo, and already null
      state: null,
      utility: null,
      projectReference: null,
    },
  ]

  const updates: Array<{ id: string; state: string | null; utility: string | null; projectReference: string | null }> = []

  for (const row of reviewRows) {
    const match = byContract.get(normalizeContractKey(row.contractNo))
    const targetState = match?.state ?? null
    const targetUtility = match?.utility ?? null
    const targetProjectReference = match?.projectReference ?? null

    const changed =
      (row.state ?? null) !== targetState ||
      (row.utility ?? null) !== targetUtility ||
      (row.projectReference ?? null) !== targetProjectReference

    if (changed) {
      updates.push({
        id: row.id,
        state: targetState,
        utility: targetUtility,
        projectReference: targetProjectReference,
      })
    }
  }

  // cr-1 gets populated with enquiry fields
  assert.equal(updates.length, 2)
  assert.deepEqual(updates[0], {
    id: 'cr-1',
    state: 'UTTAR PRADESH',
    utility: 'POWER GRID',
    projectReference: 'PR-001',
  })

  // cr-2-stale gets cleared to null
  assert.deepEqual(updates[1], {
    id: 'cr-2-stale',
    state: null,
    utility: null,
    projectReference: null,
  })
})
