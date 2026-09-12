import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rule } from './ukhsa-new-arrival-orientation'
import { GUIDE_COUNTRIES } from './country-lists.generated'
import type { PatientProfile, RuleOutcome } from './types'

/**
 * The rule that keeps the pack from ever firing empty. ADR 12 forbids curating
 * the patient, so a judge may nominate a 34-year-old with one condition and no
 * eligibility for anything; this one fires on all of them. See #17.
 */

const AS_OF = '2026-09-12T08:00:00Z'

/** Deliberately empty: the point of this rule is that it needs no record. */
function thin(country: string, ageYears: number): PatientProfile {
  return {
    patientId: 'SIM-000001',
    asOf: AS_OF,
    ageYears,
    ageMonths: ageYears * 12,
    country,
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

describe('ukhsa-new-arrival-orientation', () => {
  it('fires for every one of the 135 countries the guides cover', () => {
    assert.equal(GUIDE_COUNTRIES.length, 135)
    for (const country of GUIDE_COUNTRIES) {
      const outcomes = rule.evaluate(thin(country, 34))
      assert.equal(outcomes.length, 1, country)
      assert.equal(outcomes[0]?.kind, 'recommendation', country)
    }
  })

  it('fires for a country with no guide at all', () => {
    // `countries: 'all'` rather than the generated 135, because a patient from a
    // country UKHSA has not written up is still new to the NHS.
    assert.equal(rule.countries, 'all')
    assert.equal(rule.evaluate(thin('FR', 34)).length, 1)
  })

  it('fires at every age, on a record holding nothing', () => {
    for (const age of [0, 1, 9, 17, 34, 52, 67, 80]) {
      assert.equal(rule.evaluate(thin('BD', age)).length, 1, `age ${age}`)
    }
  })

  it('consumes no fact, so its bucket comes from the declared floor', () => {
    const outcome = recommendation(rule.evaluate(thin('BD', 34))[0])
    assert.deepEqual(outcome.consumed, [])
    assert.equal(rule.confidenceFloor, 'document-evidenced')
  })

  it('reaches the patient through a task at the practice, which consumes no capacity', () => {
    // The sim has no orientation action and gp holds six bookable slots, so this
    // lands as a create_task at gp. See ADR 5's target table and the sim skill.
    assert.equal(rule.target, 'gp')
  })

  it('templates no recommendation text from the guide row it quotes', () => {
    // ADR 15: a row may be quoted in a citation and never in the output. This is
    // the sharpest form of that here, because the quote is itself a guide row.
    const outcome = recommendation(rule.evaluate(thin('BD', 34))[0])
    const quote = rule.citations[0].quote
    const emitted = `${outcome.title} ${outcome.rationale}`
    assert.ok(!emitted.includes(quote), 'the recommendation repeats the guide row verbatim')
    assert.notEqual(outcome.title, quote)
  })

  it('names what the appointment covers in the title, because create_task drops text', () => {
    const outcome = recommendation(rule.evaluate(thin('BD', 34))[0])
    assert.match(outcome.title, /register|registration/i)
    assert.match(outcome.title, /entitle/i)
  })

  it('keys its output stably, so a re-run updates rather than duplicates', () => {
    assert.equal(rule.evaluate(thin('BD', 34))[0]?.outputKey, 'ukhsa-new-arrival-orientation:entitlements')
    assert.equal(rule.evaluate(thin('UA', 8))[0]?.outputKey, 'ukhsa-new-arrival-orientation:entitlements')
  })

  it('quotes the entitlements advice verbatim, and the page it points at', () => {
    // The first quote is the country guides' own wording of the advice, present
    // as a row in 57 of the 135 guides and as the anchor text linking this page
    // in all 135. The second is from the linked page itself, under "What this
    // guidance is for", read on 2026-09-12. Both OGL v3.0.
    assert.deepEqual(rule.citations, [
      {
        url: 'https://www.gov.uk/guidance/nhs-entitlements-migrant-health-guide',
        quote: 'explain to them how the NHS works and their entitlements to healthcare',
      },
      {
        url: 'https://www.gov.uk/guidance/nhs-entitlements-migrant-health-guide',
        quote: 'explain to new patients how the NHS operates',
      },
    ])
  })
})
