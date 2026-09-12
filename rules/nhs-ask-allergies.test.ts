import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { rule } from './nhs-ask-allergies'
import { pack } from './index'
import type { PatientProfile, ProfileFact, RuleOutcome } from './types'

/**
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rule rather than the projection.
 */

const AS_OF = '2026-09-12T08:00:00Z'

/** convex/lib/degradeRecord.ts writes this when no allergy survives the draw. */
const DEGRADER_ALLERGIES = 'Patient could not recall any known drug allergies.'

function fact(verbatim: string, resolved?: string): ProfileFact {
  return {
    key: verbatim.toLowerCase().replace(/[^a-z0-9]/g, ''),
    verbatim,
    ...(resolved === undefined ? {} : { resolved }),
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: verbatim },
    synthesised: false,
  }
}

function profile(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    patientId: 'SIM-000001',
    birthDate: '1992-01-10',
    asOf: AS_OF,
    ageYears: 34,
    ageMonths: 416,
    country: 'BD',
    conditions: [],
    medications: [],
    allergies: [],
    familyHistory: [],
    immunisations: [],
    ...overrides,
  }
}

function gap(outcome: RuleOutcome | undefined) {
  if (outcome?.kind !== 'gap') throw new Error(`expected a gap, got ${String(outcome?.kind)}`)
  return outcome
}

describe('nhs-ask-allergies', () => {
  it('asks when the record carried no allergy at all', () => {
    const outcomes = rule.evaluate(profile())

    assert.equal(outcomes.length, 1)
    assert.equal(gap(outcomes[0]).outputKey, 'nhs-ask-allergies:any')
  })

  it('asks when the only allergy on record is the sentence the degrader wrote', () => {
    // The case the rule exists for. Extraction reads the filler sentence back as
    // an allergy claim, so `profile.allergies` is non-empty and the record still
    // states nothing. See rules/negation.ts.
    const outcomes = rule.evaluate(profile({ allergies: [fact(DEGRADER_ALLERGIES)] }))

    assert.equal(outcomes.length, 1)
  })

  it('stays quiet when the record names a substance', () => {
    assert.deepEqual(rule.evaluate(profile({ allergies: [fact('Allergic to Penicillin.')] })), [])
  })

  it('stays quiet when one real allergy sits beside the filler sentence', () => {
    const outcomes = rule.evaluate(
      profile({ allergies: [fact(DEGRADER_ALLERGIES), fact('Penicillin (rash)')] }),
    )

    assert.deepEqual(outcomes, [])
  })

  it('reads allergies rather than conditions or medications', () => {
    const outcomes = rule.evaluate(
      profile({ conditions: [fact('Asthma')], medications: [fact('Napa 500mg')] }),
    )

    assert.equal(outcomes.length, 1, 'a full record elsewhere says nothing about allergy')
  })

  it('consumes the documented negative, so the screen can show why it is asking', () => {
    // Deliberate, not an oversight: consuming the array is what carries ADR 14's
    // synthesised flag through the engine and puts the "could not recall" line
    // into the gap's own evidence.
    const negative = fact(DEGRADER_ALLERGIES)
    const outcomes = rule.evaluate(profile({ allergies: [negative] }))

    assert.deepEqual(gap(outcomes[0]).consumed, [negative])
  })

  it('consumes nothing when the record held nothing to consume', () => {
    assert.deepEqual(gap(rule.evaluate(profile())[0]).consumed, [])
  })

  it('asks an open question and never a confirmation', () => {
    // docs/vapi-system-prompt.md: a tired or polite patient says yes to anything
    // phrased as "is that right?", and patients agree with confident-sounding
    // suggestions. A confirmation-shaped question manufactures the negative it
    // was meant to test.
    const { question } = gap(rule.evaluate(profile({ allergies: [fact(DEGRADER_ALLERGIES)] }))[0])

    assert.doesNotMatch(question, /is that right|is that correct|confirm|correct\?/i)
    assert.doesNotMatch(question, /your records say|records show|we have|according to/i)
    assert.doesNotMatch(question, /\bno allergies\b|\bno known\b/i)
    assert.match(question, /^(is|are|do|does|what|which|tell)/i)
  })

  it('asks what the reaction was without suggesting one', () => {
    // Call plan step 5, and hard rule 6: never infer an allergic reaction the
    // patient did not describe.
    const { question } = gap(rule.evaluate(profile())[0])

    assert.match(question, /what actually happens/i)
    assert.doesNotMatch(question, /rash|swelling|anaphyla|wheez/i)
  })

  it('speaks rather than renders: no markdown, no lists, no machine words', () => {
    const { question } = gap(rule.evaluate(profile())[0])

    assert.doesNotMatch(question, /[*_#|]|\n/)
  })

  it('fills the call before anything else in the pack', () => {
    // Priority 1, and first in pack order, because ADR 16 tie-breaks the sort on
    // pack order. An allergy is the one piece of history that changes what a
    // prescriber may safely do next.
    assert.equal(rule.priority, 1)
    assert.equal(pack[0]?.id, 'nhs-ask-allergies')
  })

  it('declares no confidenceFloor, because a gap derives no bucket', () => {
    // rules/engine.ts returns for `kind: 'gap'` before it reads the floor, so a
    // value here would be one nothing reads. See ADR 14.
    assert.equal(rule.confidenceFloor, undefined)
  })

  it('fires for every country, because a record states no allergy anywhere', () => {
    assert.equal(rule.countries, 'all')
  })

  it('quotes the migrant health guide verbatim', () => {
    // The same line nhs-record-allergy rests on, read on 2026-09-12, OGL v3.0.
    assert.deepEqual(rule.citations, [
      {
        url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
        quote: 'Offer migrants the same basic new patient check as for all registering patients.',
      },
    ])
  })
})
