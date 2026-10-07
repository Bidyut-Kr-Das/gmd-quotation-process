import test from 'node:test'
import assert from 'node:assert/strict'
import { pnRatingBucket } from '../lib/pnRatingMatcher.js'

test('PN 10 and 16 collapse to the same bucket', () => {
  assert.equal(pnRatingBucket('PN - 10'), 'PN-10/16')
  assert.equal(pnRatingBucket('PN - 16'), 'PN-10/16')
  assert.equal(pnRatingBucket('PN 1.6'), 'PN-10/16')
})

test('PN 20, 25 and 30 collapse to the same bucket', () => {
  assert.equal(pnRatingBucket('PN - 20'), 'PN-20/25/30')
  assert.equal(pnRatingBucket('PN - 25'), 'PN-20/25/30')
  assert.equal(pnRatingBucket('PN - 30'), 'PN-20/25/30')
})

test('CLASS 300 and PN 40 collapse to the same bucket', () => {
  assert.equal(pnRatingBucket('CLASS-300#'), 'CLASS-300#')
  assert.equal(pnRatingBucket('PN - 40'), 'CLASS-300#')
  assert.equal(pnRatingBucket('CLASS 300'), 'CLASS-300#')
})

test('other classes keep their own buckets', () => {
  assert.equal(pnRatingBucket('CLASS-150#'), 'CLASS-150#')
  assert.equal(pnRatingBucket('CLASS-600#'), 'CLASS-600#')
  assert.equal(pnRatingBucket('CLASS-800#'), 'CLASS-800#')
})

test('unrecognized ratings fall back to normalized raw text', () => {
  assert.equal(pnRatingBucket('  some   rating '), 'SOME RATING')
})

test('blank values bucket to empty string', () => {
  assert.equal(pnRatingBucket(''), '')
  assert.equal(pnRatingBucket(null), '')
  assert.equal(pnRatingBucket(undefined), '')
  assert.equal(pnRatingBucket('   '), '')
})
