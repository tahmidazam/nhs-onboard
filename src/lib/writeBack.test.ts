import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { mayWriteBack } from './writeBack'
import type { Recommendation } from '../types'

/**
 * The write-back boundary, asserted on the shape the engine actually emits. See
 * #33.
 */

/**
 * Bowel screening on a 67-year-old, the one recommendation ADR 14 names as
 * writable: evidenced, and resting on the sim's own birthDate. Every case below
 * is this row with one field moved, so each test isolates the ground it refuses
 * on.
 */
function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'rec-1',
    patientId: 'pat-1',
    kind: 'screening',
    title: 'Invite to bowel screening, two-yearly',
    rationale: 'Aged 67 on the frozen clock, inside the 50 to 74 band.',
    confidence: 'document-evidenced',
    evidence: [{ kind: 'sim-record', id: 'SIM-000015', quote: '1959-06-06' }],
    target: 'referrals',
    status: 'proposed',
    ...overrides,
  }
}

describe('mayWriteBack', () => {
  it('refuses an evidenced recommendation resting on a synthesised document', () => {
    // The bug #33 names: the bucket alone would let ADR 8's generated
    // vaccination card reach a draft referral.
    assert.deepEqual(mayWriteBack(recommendation({ synthesised: true })), {
      writable: false,
      refusal: 'synthesised-evidence',
    })
  })

  it('allows the same recommendation once the synthesised flag comes off', () => {
    // The label is the only thing between the two cases, which is why ADR 14
    // demotes no bucket to get this refusal.
    assert.deepEqual(mayWriteBack(recommendation()), { writable: true })
  })

  it('refuses a patient-reported recommendation as unconfirmed', () => {
    // ADR 3: the patient's word becomes a question for the clinician, so the
    // refusal has to name confirmation rather than say only "not evidenced".
    assert.deepEqual(mayWriteBack(recommendation({ confidence: 'patient-reported' })), {
      writable: false,
      refusal: 'unconfirmed-report',
    })
  })

  it('refuses an uncertain-mapping recommendation as unresolved', () => {
    // ADR 3 never actions this bucket at all, so the clinician is told the
    // mapping failed rather than invited to confirm a guess.
    assert.deepEqual(mayWriteBack(recommendation({ confidence: 'uncertain-mapping' })), {
      writable: false,
      refusal: 'unresolved-mapping',
    })
  })

  it('reports the synthesised ground first when a row fails on both', () => {
    // The shipped pack emits exactly this row: the primary course plans off the
    // synthesised card and floors at patient-reported. A clinician told only
    // that it needs confirming would go and confirm it, so the invented source
    // is the ground worth naming.
    assert.deepEqual(
      mayWriteBack(recommendation({ confidence: 'patient-reported', synthesised: true })),
      { writable: false, refusal: 'synthesised-evidence' },
    )
  })
})
