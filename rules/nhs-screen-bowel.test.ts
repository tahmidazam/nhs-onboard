import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rule } from './nhs-screen-bowel'
import type { PatientProfile, RuleOutcome } from './types'

/**
 * The evidenced path, end to end, resting on nothing invented. See #16.
 *
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rule rather than the projection.
 */

/** The frozen sim clock, per ADR 11. Every age below is stated, never computed. */
const AS_OF = '2026-09-12T08:00:00Z'

function aged(ageYears: number): PatientProfile {
  return {
    patientId: 'SIM-000001',
    asOf: AS_OF,
    ageYears,
    ageMonths: ageYears * 12,
    country: 'BD',
    conditions: [],
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

describe('nhs-screen-bowel', () => {
  it('fires at 50, the first invited age', () => {
    const outcomes = rule.evaluate(aged(50))
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0]?.kind, 'recommendation')
  })

  it('fires at 74, the last invited age', () => {
    assert.equal(rule.evaluate(aged(74)).length, 1)
  })

  it('does not fire at 49', () => {
    assert.deepEqual(rule.evaluate(aged(49)), [])
  })

  it('does not fire at 75', () => {
    // Over-75s can request a kit by phone, which is a self-referral route and
    // not something a GP referral opens. The quoted invitation range ends at 74.
    assert.deepEqual(rule.evaluate(aged(75)), [])
  })

  it('rests on the birthDate from the sim record, so the engine buckets it document-evidenced', () => {
    const outcome = recommendation(rule.evaluate(aged(52))[0])
    assert.equal(outcome.consumed.length, 1)
    const [age] = outcome.consumed
    assert.equal(age?.confidence, 'document-evidenced')
    assert.equal(age?.source.kind, 'sim-record')
    assert.equal(age?.source.id, 'SIM-000001')
    assert.equal(age?.synthesised, false)
  })

  it('declares no confidence floor, so the bucket comes from the evidence', () => {
    // ADR 14: a floor is for a rule that consumes no fact. This one consumes the age.
    assert.equal(rule.confidenceFloor, undefined)
  })

  it('carries the age and the interval in the title, because create_referral drops text', () => {
    const outcome = recommendation(rule.evaluate(aged(52))[0])
    assert.match(outcome.title, /52/)
    assert.match(outcome.title, /50 to 74/)
    assert.match(outcome.title, /2 years/)
  })

  it('keys its output stably, so a re-run updates rather than duplicates', () => {
    const first = rule.evaluate(aged(52))[0]
    const second = rule.evaluate(aged(53))[0]
    assert.equal(first?.outputKey, 'nhs-screen-bowel:invite')
    assert.equal(second?.outputKey, 'nhs-screen-bowel:invite')
  })

  it('targets the referrals site as a screening recommendation', () => {
    assert.equal(rule.kind, 'screening')
    assert.equal(rule.target, 'referrals')
  })

  it('quotes the programme overview verbatim', () => {
    // Transcribed from https://www.gov.uk/api/content/guidance/bowel-cancer-screening-programme-overview
    // on 2026-09-12. OGL v3.0. Changing this line means re-reading the source.
    assert.deepEqual(rule.citations, [
      {
        url: 'https://www.gov.uk/guidance/bowel-cancer-screening-programme-overview',
        quote: 'We invite people aged 50 to 74 years for bowel cancer screening every 2 years.',
      },
    ])
  })
})
