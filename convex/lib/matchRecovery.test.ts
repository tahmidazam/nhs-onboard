import { describe, expect, it } from 'vitest'
import { matchRecovery } from './matchRecovery'
import type { Truth } from './matchRecovery'
import type { Claim } from '../../src/types'

/** Fills in the SourceRef and confidence fields a test does not care about. */
function claim(overrides: Partial<Claim> & Pick<Claim, 'kind' | 'verbatim'>): Claim {
  return {
    id: 'claim-1',
    patientId: 'patient-1',
    resolved: undefined,
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: overrides.verbatim },
    ...overrides,
  }
}

const emptyTruth: Truth = { conditions: [], medications: [], allergies: [], immunisations: [] }

describe('matchRecovery', () => {
  it('matches a medication on the mapped UK ingredient, not the brand string', () => {
    const truth: Truth = { ...emptyTruth, medications: ['Paracetamol'] }
    const claims: Claim[] = [
      claim({
        kind: 'medication',
        verbatim: 'Napa',
        mapping: {
          brand: 'Napa',
          generic: 'Paracetamol',
          ukIngredient: 'Paracetamol',
          via: 'bd-medex',
          unresolved: false,
        },
      }),
    ]

    expect(matchRecovery(truth, claims)).toEqual({ total: 1, recovered: 1 })
  })

  it('does not match a medication on its brand string alone', () => {
    const truth: Truth = { ...emptyTruth, medications: ['Paracetamol'] }
    const claims: Claim[] = [claim({ kind: 'medication', verbatim: 'Napa' })]

    expect(matchRecovery(truth, claims)).toEqual({ total: 1, recovered: 0 })
  })

  it('matches a condition by normalised substring in either direction', () => {
    const truth: Truth = { ...emptyTruth, conditions: ['Type 2 diabetes mellitus'] }
    const claims: Claim[] = [claim({ kind: 'condition', verbatim: 'diabetes', resolved: 'diabetes' })]

    expect(matchRecovery(truth, claims)).toEqual({ total: 1, recovered: 1 })
  })

  it('matches an allergy by normalised substring regardless of punctuation and case', () => {
    const truth: Truth = { ...emptyTruth, allergies: ['Penicillin'] }
    const claims: Claim[] = [claim({ kind: 'allergy', verbatim: 'Penicillin!', resolved: 'penicillin' })]

    expect(matchRecovery(truth, claims)).toEqual({ total: 1, recovered: 1 })
  })

  it('excludes a synthesised immunisation fact from the denominator', () => {
    const truth: Truth = { ...emptyTruth, immunisations: ['MMR, as a child'] }
    const claims: Claim[] = [claim({ kind: 'immunisation', verbatim: 'MMR, as a child', resolved: 'MMR' })]

    expect(matchRecovery(truth, claims)).toEqual({ total: 0, recovered: 0 })
  })

  it('reads zero recovered when no claims exist yet', () => {
    const truth: Truth = { conditions: ['Asthma'], medications: ['Salbutamol'], allergies: ['Penicillin'], immunisations: [] }

    expect(matchRecovery(truth, [])).toEqual({ total: 3, recovered: 0 })
  })

  it('does not double count a truth fact matched by more than one claim', () => {
    const truth: Truth = { ...emptyTruth, conditions: ['Asthma'] }
    const claims: Claim[] = [
      claim({ id: 'c1', kind: 'condition', verbatim: 'asthma', resolved: 'asthma' }),
      claim({ id: 'c2', kind: 'condition', verbatim: 'Asthma, mild', resolved: 'asthma' }),
    ]

    expect(matchRecovery(truth, claims)).toEqual({ total: 1, recovered: 1 })
  })
})
