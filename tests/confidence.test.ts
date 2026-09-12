import { describe, expect, it } from 'vitest'
import { bucketFor } from '../convex/lib/confidence'

describe('bucketFor', () => {
  it('evidences an anchored document claim whose mapping resolved', () => {
    expect(bucketFor({ sourceKind: 'document', verified: true, mappingUnresolved: false })).toBe(
      'document-evidenced',
    )
  })

  it('evidences an anchored document claim with no mapping at all', () => {
    expect(bucketFor({ sourceKind: 'document', verified: true })).toBe('document-evidenced')
  })

  it('demotes an anchored document claim whose mapping is unresolved', () => {
    expect(bucketFor({ sourceKind: 'document', verified: true, mappingUnresolved: true })).toBe(
      'uncertain-mapping',
    )
  })

  it('demotes an unanchored document claim whatever the mapping says', () => {
    expect(bucketFor({ sourceKind: 'document', verified: false, mappingUnresolved: false })).toBe(
      'uncertain-mapping',
    )
    expect(bucketFor({ sourceKind: 'document', verified: false, mappingUnresolved: true })).toBe(
      'uncertain-mapping',
    )
  })

  it('demotes a document claim that was never anchored at all', () => {
    expect(bucketFor({ sourceKind: 'document' })).toBe('uncertain-mapping')
  })

  it('reports a transcript claim, so it cannot reach the prescription path', () => {
    expect(bucketFor({ sourceKind: 'transcript' })).toBe('patient-reported')
    expect(bucketFor({ sourceKind: 'transcript', verified: true, mappingUnresolved: true })).toBe(
      'patient-reported',
    )
  })

  it('evidences a sim-record claim, which carries no quote to anchor', () => {
    expect(bucketFor({ sourceKind: 'sim-record' })).toBe('document-evidenced')
    expect(bucketFor({ sourceKind: 'sim-record', mappingUnresolved: true })).toBe(
      'document-evidenced',
    )
  })
})
