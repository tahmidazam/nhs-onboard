import { describe, expect, it } from 'vitest'
import { matchRecovery } from './matchRecovery'
import type { Truth } from './matchRecovery'
import type { Claim } from '../../src/types'

/**
 * Fills in the SourceRef and confidence fields a test does not care about. The
 * default source is an anchored document quote, so a test that says nothing
 * about anchoring gets a claim that counts. See ADR 17.
 */
function claim(overrides: Partial<Claim> & Pick<Claim, 'kind' | 'verbatim'>): Claim {
  return {
    id: 'claim-1',
    patientId: 'patient-1',
    resolved: undefined,
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: overrides.verbatim, verified: true },
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

describe('matchRecovery anchoring predicate', () => {
  const asthmaTruth: Truth = { ...emptyTruth, conditions: ['Asthma'] }

  /** A condition claim that would match `asthmaTruth`, carrying the given source. */
  function asthmaClaim(source: Claim['source']): Claim {
    return claim({ kind: 'condition', verbatim: 'asthma', resolved: 'asthma', source })
  }

  it('counts a document claim whose quote anchored', () => {
    const claims = [asthmaClaim({ kind: 'document', id: 'doc-1', quote: 'asthma', verified: true })]

    expect(matchRecovery(asthmaTruth, claims)).toEqual({ total: 1, recovered: 1 })
  })

  it('does not count a document claim whose quote failed to anchor, and leaves the denominator alone', () => {
    const claims = [asthmaClaim({ kind: 'document', id: 'doc-1', quote: 'asthma', verified: false })]

    expect(matchRecovery(asthmaTruth, claims)).toEqual({ total: 1, recovered: 0 })
  })

  it('does not count a document claim with no verified field, which was never anchored', () => {
    const claims = [asthmaClaim({ kind: 'document', id: 'doc-1', quote: 'asthma' })]

    expect(matchRecovery(asthmaTruth, claims)).toEqual({ total: 1, recovered: 0 })
  })

  it('counts a transcript claim, which has no quote to verify', () => {
    const claims = [asthmaClaim({ kind: 'transcript', id: 'call-1', quote: 'I have asthma' })]

    expect(matchRecovery(asthmaTruth, claims)).toEqual({ total: 1, recovered: 1 })
  })

  it('counts a sim-record claim, which has no quote to verify', () => {
    const claims = [asthmaClaim({ kind: 'sim-record', id: 'cond-1', quote: 'Asthma' })]

    expect(matchRecovery(asthmaTruth, claims)).toEqual({ total: 1, recovered: 1 })
  })

  it('applies the predicate to medications, which match on the mapped ingredient rather than text', () => {
    const truth: Truth = { ...emptyTruth, medications: ['Paracetamol'] }
    const mapping = {
      brand: 'Napa',
      generic: 'Paracetamol',
      ukIngredient: 'Paracetamol',
      via: 'bd-medex' as const,
      unresolved: false,
    }

    const anchored: Claim[] = [
      claim({
        kind: 'medication',
        verbatim: 'Napa',
        mapping,
        source: { kind: 'document', id: 'doc-1', quote: 'Napa 500mg', verified: true },
      }),
    ]
    const unanchored: Claim[] = [
      claim({
        kind: 'medication',
        verbatim: 'Napa',
        mapping,
        source: { kind: 'document', id: 'doc-1', quote: 'Napa 500mg', verified: false },
      }),
    ]

    expect(matchRecovery(truth, anchored)).toEqual({ total: 1, recovered: 1 })
    expect(matchRecovery(truth, unanchored)).toEqual({ total: 1, recovered: 0 })
  })

  it('still counts a fact an anchored claim reaches when an unanchored claim covers the same ground', () => {
    const claims: Claim[] = [
      asthmaClaim({ kind: 'document', id: 'doc-1', quote: 'asthma', verified: false }),
      claim({
        id: 'c2',
        kind: 'condition',
        verbatim: 'asthma',
        resolved: 'asthma',
        source: { kind: 'transcript', id: 'call-1', quote: 'asthma' },
      }),
    ]

    expect(matchRecovery(asthmaTruth, claims)).toEqual({ total: 1, recovered: 1 })
  })
})
