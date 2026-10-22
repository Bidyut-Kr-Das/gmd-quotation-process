import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDocketEmailHtml, buildItemsClause } from '../lib/docketEmailTemplate.js'

const html = (itemsClause?: string) =>
  buildDocketEmailHtml({
    docketNumber: 'GMD/2026-27/561',
    itemsClause,
    pdfUrl: 'https://example.com/offer.pdf',
    fileName: 'GMD-561.pdf',
  })

test('one item is named in the offer sentence', () => {
  const clause = buildItemsClause(['BUTTERFLY VALVE'])
  assert.equal(clause, 'for the requested BUTTERFLY VALVE')
  assert.match(html(clause), /for the requested BUTTERFLY VALVE\./)
  assert.doesNotMatch(html(clause), /BOQ/)
})

test('several items point at the attached BOQ instead of listing them', () => {
  const clause = buildItemsClause(['BUTTERFLY VALVE', 'SLUICE VALVE'])
  assert.equal(clause, 'for the items required for the said project as per the attached BOQ')
  const body = html(clause)
  assert.match(body, /as per the attached BOQ\./)
  assert.doesNotMatch(body, /BUTTERFLY VALVE/)
  assert.doesNotMatch(body, /SLUICE VALVE/)
})

test('duplicate names collapse, so two sizes of one item are still named', () => {
  assert.equal(
    buildItemsClause(['BUTTERFLY VALVE', ' BUTTERFLY VALVE ']),
    'for the requested BUTTERFLY VALVE',
  )
})

test('no items leaves the sentence at the reference', () => {
  assert.equal(buildItemsClause([]), '')
  assert.equal(buildItemsClause(['', '  ']), '')
  assert.doesNotMatch(html(buildItemsClause([])), /for the requested|BOQ/)
})

test('an item name is HTML-escaped', () => {
  assert.match(html(buildItemsClause(['VALVE <A> & B'])), /VALVE &lt;A&gt; &amp; B/)
})
