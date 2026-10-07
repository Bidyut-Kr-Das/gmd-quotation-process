import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseThreadAttachments,
  inferAttachmentType,
  buildDocketSnapshotHtml,
} from '../lib/docketSnapshot.js'

test('inferAttachmentType maps common extensions', () => {
  assert.equal(inferAttachmentType('quote.pdf'), 'application/pdf')
  assert.equal(inferAttachmentType('scan.JPG'), 'image/jpeg')
  assert.equal(inferAttachmentType('data.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(inferAttachmentType('noext'), null)
})

test('parseThreadAttachments aligns names and links, skipping sentinels and no-link rows', () => {
  const rows = parseThreadAttachments(
    ['a.pdf', '[No Attachments]', 'b.docx', 'c.txt'],
    ['https://drive/1', '[No Links]', 'https://drive/2', ''],
  )
  assert.deepEqual(rows, [
    { name: 'a.pdf', url: 'https://drive/1', type: 'application/pdf' },
    {
      name: 'b.docx',
      url: 'https://drive/2',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  ])
})

test('parseThreadAttachments de-duplicates and tolerates scalar / value wrappers', () => {
  const rows = parseThreadAttachments(
    ['x.pdf', 'x.pdf'],
    ['https://drive/x', 'https://drive/x'],
  )
  assert.equal(rows.length, 1)

  const scalar = parseThreadAttachments({ value: 'only.pdf' }, { value: 'https://drive/only' })
  assert.deepEqual(scalar, [{ name: 'only.pdf', url: 'https://drive/only', type: 'application/pdf' }])
})

test('parseThreadAttachments returns empty for missing data', () => {
  assert.deepEqual(parseThreadAttachments(null, null), [])
  assert.deepEqual(parseThreadAttachments([], []), [])
})

test('buildDocketSnapshotHtml includes fields, attachments and escapes HTML', () => {
  const html = buildDocketSnapshotHtml({
    docketNumber: 'GMD/2026-27/500',
    partyName: 'ACME <Valves> & Co',
    subject: 'RFQ <script>alert(1)</script>',
    sender: 'buyer@acme.com',
    body: 'Line1\nLine2',
    attachments: [{ name: 'spec.pdf', url: 'https://drive/spec' }],
  })
  assert.match(html, /GMD\/2026-27\/500/)
  assert.match(html, /ACME &lt;Valves&gt; &amp; Co/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /https:\/\/drive\/spec/)
  assert.match(html, /spec\.pdf/)
  assert.doesNotMatch(html, /<script>alert/)
})
