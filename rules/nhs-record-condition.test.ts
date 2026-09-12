import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { rule as conditionRule } from './nhs-record-condition'
import { rule as allergyRule } from './nhs-record-allergy'
import type { PatientProfile, ProfileFact, RuleOutcome } from './types'

/**
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rules rather than the projection.
 */

const AS_OF = '2026-09-12T08:00:00Z'

function fact(verbatim: string, resolved?: string): ProfileFact {
  return {
    key: verbatim.toLowerCase().replace(/[^a-z0-9]/g, ''),
    verbatim,
    resolved,
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: verbatim },
    synthesised: false,
  }
}

function profile(overrides: Partial<PatientProfile>): PatientProfile {
  return {
    patientId: 'SIM-000001',
    birthDate: '1968-04-11',
    asOf: AS_OF,
    ageYears: 58,
    ageMonths: 58 * 12,
    country: 'BD',
    conditions: [],
    medications: [],
    allergies: [],
    familyHistory: [],
    immunisations: [],
    ...overrides,
  }
}

function recommendation(outcome: RuleOutcome | undefined) {
  if (outcome?.kind !== 'recommendation') {
    throw new Error(`expected a recommendation, got ${String(outcome?.kind)}`)
  }
  return outcome
}

describe('nhs-record-condition', () => {
  it('proposes the resolved term when the mapping found one', () => {
    const outcomes = conditionRule.evaluate(profile({ conditions: [fact('DM tipo 2', 'Type 2 diabetes')] }))

    assert.equal(outcomes.length, 1)
    assert.equal(recommendation(outcomes[0]).title, 'Type 2 diabetes')
  })

  it('falls back to the verbatim text when nothing resolved it', () => {
    const outcomes = conditionRule.evaluate(profile({ conditions: [fact('shortness of breath')] }))

    assert.equal(recommendation(outcomes[0]).title, 'shortness of breath')
  })

  it('keeps the original wording in the rationale so the GP can see what was read', () => {
    const outcomes = conditionRule.evaluate(profile({ conditions: [fact('DM tipo 2', 'Type 2 diabetes')] }))

    assert.match(recommendation(outcomes[0]).rationale, /DM tipo 2/)
  })

  it('proposes one problem per condition, each separately keyed', () => {
    const outcomes = conditionRule.evaluate(
      profile({ conditions: [fact('asthma'), fact('hypertension')] }),
    )

    assert.equal(outcomes.length, 2)
    assert.equal(new Set(outcomes.map((o) => recommendation(o).outputKey)).size, 2)
  })

  it('proposes nothing for a patient whose records carried no conditions', () => {
    assert.deepEqual(conditionRule.evaluate(profile({})), [])
  })

  it('reads conditions rather than allergies', () => {
    assert.deepEqual(conditionRule.evaluate(profile({ allergies: [fact('penicillin')] })), [])
  })
})

describe('nhs-record-allergy', () => {
  it('proposes one allergy per fact', () => {
    const outcomes = allergyRule.evaluate(
      profile({ allergies: [fact('penicilina', 'Penicillin'), fact('peanuts')] }),
    )

    assert.equal(outcomes.length, 2)
    assert.deepEqual(outcomes.map((o) => recommendation(o).title), ['Penicillin', 'peanuts'])
  })

  it('reads allergies rather than conditions', () => {
    assert.deepEqual(allergyRule.evaluate(profile({ conditions: [fact('asthma')] })), [])
  })

  it('consumes the fact it read, so the engine derives the bucket', () => {
    const allergy = fact('penicilina', 'Penicillin')
    const out = recommendation(allergyRule.evaluate(profile({ allergies: [allergy] }))[0])

    assert.deepEqual(out.consumed, [allergy])
  })
})
