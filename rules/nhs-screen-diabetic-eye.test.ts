import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { normaliseKey } from '../src/lib/normalise'
import { rule } from './nhs-screen-diabetic-eye'
import type { Confidence } from '../src/types'
import type { PatientProfile, ProfileFact, RuleOutcome } from './types'

/**
 * The only rule in the pack whose trigger is the patient's own record, so these
 * are the tests that prove the engine reads it. See #16.
 */

const AS_OF = '2026-09-12T08:00:00Z'

/**
 * A condition as the profile builder hands it over: `key` already normalised by
 * ADR 11's matcher. The fixtures below pass the term the sim or the document
 * wrote, so the test exercises the same normalisation the builder applies.
 */
function condition(verbatim: string, overrides: Partial<ProfileFact> = {}): ProfileFact {
  return {
    key: normaliseKey(verbatim),
    verbatim,
    confidence: 'document-evidenced',
    source: { kind: 'sim-record', id: 'SIM-000001', quote: verbatim },
    synthesised: false,
    ...overrides,
  }
}

/** Born the same month and day as AS_OF, so the patient is exactly `ageYears` on it. */
function bornYearsBefore(ageYears: number): string {
  return `${2026 - ageYears}-09-12`
}

function profile(ageYears: number, conditions: ProfileFact[]): PatientProfile {
  return {
    patientId: 'SIM-000001',
    birthDate: bornYearsBefore(ageYears),
    asOf: AS_OF,
    ageYears,
    ageMonths: ageYears * 12,
    country: 'BD',
    conditions,
    medications: [],
    allergies: [],
    immunisations: [],
  }
}

/** Narrows the union, so a gap where a recommendation belongs fails here. */
function recommendation(outcome: RuleOutcome | undefined) {
  if (outcome?.kind !== 'recommendation') {
    throw new Error(`expected a recommendation, got ${String(outcome?.kind)}`)
  }
  return outcome
}

describe('nhs-screen-diabetic-eye', () => {
  it('fires on the terse term the sim writes', () => {
    // The sim's problem list says "Diabetes", not "Type 2 diabetes mellitus".
    const outcomes = rule.evaluate(profile(52, [condition('Diabetes')]))
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0]?.kind, 'recommendation')
  })

  it('fires on the full term a UK record would write', () => {
    const outcomes = rule.evaluate(profile(52, [condition('Type 2 diabetes mellitus')]))
    assert.equal(outcomes.length, 1)
  })

  it('fires on the same term recovered from a foreign document', () => {
    const outcomes = rule.evaluate(
      profile(52, [
        condition('Diabetes mellitus type 2', {
          confidence: 'patient-reported',
          source: { kind: 'transcript', id: 'call-1', quote: 'I have sugar disease' },
        }),
      ]),
    )
    assert.equal(outcomes.length, 1)
  })

  it('does not fire without diabetes', () => {
    assert.deepEqual(rule.evaluate(profile(52, [condition('Hypertension')])), [])
  })

  it('does not fire on a resolved diabetes problem', () => {
    // The sim's problem list carries `status`, the profile does not: resolution is
    // filtered when the profile is built, so a resolved diabetes never reaches
    // `conditions`. The rule therefore reads the active set and claims no more
    // certainty than that. A degraded document that lost the resolution is a
    // separate case we deliberately do not correct for. See CONTEXT.md known gaps.
    const activeSetWithoutTheResolvedDiabetes = [condition('Hypertension')]
    assert.deepEqual(rule.evaluate(profile(52, activeSetWithoutTheResolvedDiabetes)), [])
  })

  it('does not fire under 12', () => {
    assert.deepEqual(rule.evaluate(profile(11, [condition('Diabetes')])), [])
  })

  it('fires at 12, the first invited age', () => {
    assert.equal(rule.evaluate(profile(12, [condition('Diabetes')])).length, 1)
  })

  it('inherits its bucket from the diabetes fact rather than declaring one', () => {
    // ADR 14: the engine takes the minimum across `consumed`. This rule declares
    // no floor, so whatever the problem-list entry is worth is what the referral
    // is worth.
    assert.equal(rule.confidenceFloor, undefined)

    const buckets: Confidence[] = ['document-evidenced', 'patient-reported', 'uncertain-mapping']
    for (const confidence of buckets) {
      const [outcome] = rule.evaluate(profile(52, [condition('Diabetes', { confidence })]))
      const rec = recommendation(outcome)
      assert.equal(rec.consumed.length, 1)
      assert.equal(rec.consumed[0]?.confidence, confidence)
    }
  })

  it('consumes the diabetes fact, not the age, so the evidence is the problem list', () => {
    const outcome = recommendation(rule.evaluate(profile(52, [condition('Diabetes')]))[0])
    assert.deepEqual(
      outcome.consumed.map((f) => f.verbatim),
      ['Diabetes'],
    )
  })

  it('passes a synthesised diabetes fact through, so the label propagates', () => {
    const outcomes = rule.evaluate(profile(52, [condition('Diabetes', { synthesised: true })]))
    const outcome = recommendation(outcomes[0])
    assert.equal(outcome.consumed[0]?.synthesised, true)
  })

  it('rests on the best-evidenced entry when the record says diabetes twice', () => {
    const outcomes = rule.evaluate(
      profile(52, [
        condition('diabetes?', { confidence: 'uncertain-mapping' }),
        condition('Diabetes'),
      ]),
    )
    const outcome = recommendation(outcomes[0])
    assert.equal(outcome.consumed.length, 1)
    assert.equal(outcome.consumed[0]?.confidence, 'document-evidenced')
  })

  it('does not match a fact with an empty key', () => {
    // Matching in either direction means every term contains '', so an unkeyable
    // condition would otherwise refer the patient for eye screening.
    assert.deepEqual(rule.evaluate(profile(52, [condition('?')])), [])
  })

  it('carries the evidence in the title, because create_referral drops text', () => {
    const outcomes = rule.evaluate(profile(52, [condition('Type 2 diabetes mellitus')]))
    const outcome = recommendation(outcomes[0])
    assert.match(outcome.title, /Type 2 diabetes mellitus/)
  })

  it('keys its output stably, so a re-run updates rather than duplicates', () => {
    const outcome = rule.evaluate(profile(52, [condition('Diabetes')]))[0]
    assert.equal(outcome?.outputKey, 'nhs-screen-diabetic-eye:invite')
  })

  it('targets the referrals site as a screening recommendation', () => {
    assert.equal(rule.kind, 'screening')
    assert.equal(rule.target, 'referrals')
  })

  it('quotes the programme overview verbatim', () => {
    // Transcribed from https://www.gov.uk/api/content/guidance/diabetic-eye-screening-programme-overview
    // on 2026-09-12. OGL v3.0. The source renders a non-breaking space after
    // "over"; it is a plain space here.
    assert.deepEqual(rule.citations, [
      {
        url: 'https://www.gov.uk/guidance/diabetic-eye-screening-programme-overview',
        quote: 'Everyone with diabetes who is 12 years old or over is invited for eye screening.',
      },
    ])
  })
})
