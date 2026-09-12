import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { rule } from './nhs-continue-medication'
import type { PatientProfile, ProfileFact, RuleOutcome } from './types'

/**
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rule rather than the projection.
 */

const AS_OF = '2026-09-12T08:00:00Z'

function medication(verbatim: string, resolved?: string): ProfileFact {
  return {
    key: verbatim.toLowerCase().replace(/[^a-z0-9]/g, ''),
    verbatim,
    resolved,
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: verbatim },
    synthesised: false,
  }
}

function taking(medications: ProfileFact[]): PatientProfile {
  return {
    patientId: 'SIM-000001',
    birthDate: '1968-04-11',
    asOf: AS_OF,
    ageYears: 58,
    ageMonths: 58 * 12,
    country: 'BD',
    conditions: [],
    medications,
    allergies: [],
    immunisations: [],
  }
}

function recommendation(outcome: RuleOutcome | undefined) {
  if (outcome?.kind !== 'recommendation') {
    throw new Error(`expected a recommendation, got ${String(outcome?.kind)}`)
  }
  return outcome
}

describe('nhs-continue-medication', () => {
  it('proposes continuing a brand that resolved to a UK ingredient', () => {
    const outcomes = rule.evaluate(taking([medication('Napa', 'Paracetamol')]))

    assert.equal(outcomes.length, 1)
    const out = recommendation(outcomes[0])
    assert.match(out.title, /Paracetamol/)
    assert.match(out.title, /Napa/)
  })

  it('leaves an unresolved brand alone rather than proposing it', () => {
    assert.deepEqual(rule.evaluate(taking([medication('Ecosprin')])), [])
  })

  it('proposes one continuation per resolved medication', () => {
    const outcomes = rule.evaluate(
      taking([
        medication('Napa', 'Paracetamol'),
        medication('No-Spa', 'Drotaverine'),
        medication('Mystery tablet'),
      ]),
    )

    assert.equal(outcomes.length, 2)
    assert.equal(new Set(outcomes.map((o) => recommendation(o).outputKey)).size, 2)
  })

  it('consumes the fact it read, so the engine derives the bucket', () => {
    const fact = medication('Napa', 'Paracetamol')
    const out = recommendation(rule.evaluate(taking([fact]))[0])

    assert.deepEqual(out.consumed, [fact])
  })
})
