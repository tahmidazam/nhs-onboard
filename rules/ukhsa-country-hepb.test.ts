import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { rule } from './ukhsa-country-hepb'
import { HEPB_GUIDE_ROWS, HEPB_SCREENING_COUNTRIES } from './country-lists.generated'
import type { PatientProfile, RuleOutcome } from './types'

/**
 * The country-gated rule, and the test that protects ADR 15's boundary: the
 * guides gate this rule and cite it, and none of its text comes out of a row.
 * See #17.
 *
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rule rather than the projection.
 */

/** The frozen sim clock, per ADR 11. Nothing here depends on it. */
const AS_OF = '2026-09-12T08:00:00Z'

/** ISO 3166-1 alpha-2, supplied at onboarding and never inferred. See ADR 9. */
function from(country: string): PatientProfile {
  return {
    patientId: 'SIM-000001',
    // Exactly 34 on the clock: nothing here reads the age, but the two must agree.
    birthDate: '1992-09-12',
    asOf: AS_OF,
    ageYears: 34,
    ageMonths: 34 * 12,
    country,
    conditions: [],
    medications: [],
    allergies: [],
    familyHistory: [],
    immunisations: [],
  }
}

/**
 * Overlapping runs of six words, normalised. Six is long enough that a shared
 * run is quotation rather than coincidence, and short enough to catch a row
 * spliced into a sentence rather than pasted whole.
 */
function shingles(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
  return words.slice(0, Math.max(0, words.length - 5)).map((_, i) => words.slice(i, i + 6).join(' '))
}

/** Narrows the union, so a gap where a recommendation belongs fails here. */
function recommendation(outcome: RuleOutcome | undefined) {
  if (outcome?.kind !== 'recommendation') {
    throw new Error(`expected a recommendation, got ${String(outcome?.kind)}`)
  }
  return outcome
}

describe('ukhsa-country-hepb', () => {
  it('fires for Bangladesh, which is on the generated list', () => {
    const outcomes = rule.evaluate(from('BD'))
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0]?.kind, 'recommendation')
  })

  it('does not fire for Japan, whose guide has the section but not the screening line', () => {
    // The gate is the guidance's own: Japan's guide states low prevalence and
    // omits "consider screening", so the section alone is not eligibility.
    assert.ok(!HEPB_SCREENING_COUNTRIES.includes('JP'))
    assert.deepEqual(rule.evaluate(from('JP')), [])
  })

  it('does not fire for a country the guides do not cover', () => {
    assert.deepEqual(rule.evaluate(from('FR')), [])
  })

  it('reads the country code however an operator cased it', () => {
    // ADR 9: the field is written by a person or a call, not by a lookup.
    assert.equal(rule.evaluate(from('bd')).length, 1)
  })

  it('fires for every one of the countries on its list', () => {
    for (const country of HEPB_SCREENING_COUNTRIES) {
      assert.equal(rule.evaluate(from(country)).length, 1, country)
    }
  })

  it('attaches the patient own guide rows as secondary citations', () => {
    const outcome = recommendation(rule.evaluate(from('BD'))[0])
    // ADR 15: the matched row travels alongside the rule's primary citation.
    assert.deepEqual(outcome.extraCitations, HEPB_GUIDE_ROWS.BD)
    for (const citation of outcome.extraCitations ?? []) {
      assert.equal(citation.url, 'https://www.gov.uk/guidance/bangladesh-migrant-health-guide')
    }
    assert.ok(
      outcome.extraCitations?.some((c) => c.quote.includes('Bangladesh')),
      'the country-specific line is the whole reason the guides are carried',
    )
  })

  it('cites the same countries it gates on', () => {
    assert.notEqual(rule.countries, 'all')
    assert.deepEqual(rule.countries, HEPB_SCREENING_COUNTRIES)
    assert.deepEqual(Object.keys(HEPB_GUIDE_ROWS).sort(), [...HEPB_SCREENING_COUNTRIES].sort())
  })

  it('templates no recommendation text from a guide row', () => {
    // The hard constraint of ADR 15. A row names no destination, no specimen and
    // no interval, so text that came out of one is generated rather than
    // encoded. Rows may only be quoted in a citation.
    for (const country of HEPB_SCREENING_COUNTRIES) {
      const outcome = recommendation(rule.evaluate(from(country))[0])
      const emitted = new Set(shingles(`${outcome.title} ${outcome.rationale}`))
      for (const row of HEPB_GUIDE_ROWS[country] ?? []) {
        for (const run of shingles(row.quote)) {
          assert.ok(!emitted.has(run), `${country} recommendation repeats the guide row: "${run}"`)
        }
      }
    }
  })

  it('refers rather than ordering a test, because serology is not one of the six panels', () => {
    // The sim's order_test accepts fbc, ue, hba1c, lft, crp and lipids only, and
    // diagnostics holds four capacity slots that never refill. See ADR 5's table.
    assert.equal(rule.kind, 'screening')
    assert.equal(rule.target, 'referrals')
    const outcome = recommendation(rule.evaluate(from('BD'))[0])
    for (const panel of ['fbc', 'ue', 'hba1c', 'lft', 'crp', 'lipids']) {
      assert.ok(!outcome.title.toLowerCase().includes(panel), `${panel} is a panel, not a referral`)
    }
  })

  it('names the specimen and the destination in the title, because create_referral drops text', () => {
    const outcome = recommendation(rule.evaluate(from('BD'))[0])
    assert.match(outcome.title, /serology/i)
    assert.match(outcome.title, /blood/i)
  })

  it('consumes no fact, so its bucket comes from the declared floor', () => {
    // Country is supplied at onboarding rather than extracted from a document,
    // so there is no Claim under this rule. ADR 14's floor is what buckets it.
    const outcome = recommendation(rule.evaluate(from('BD'))[0])
    assert.deepEqual(outcome.consumed, [])
    assert.equal(rule.confidenceFloor, 'document-evidenced')
  })

  it('keys its output stably, so a re-run updates rather than duplicates', () => {
    assert.equal(rule.evaluate(from('BD'))[0]?.outputKey, 'ukhsa-country-hepb:serology')
    assert.equal(rule.evaluate(from('NG'))[0]?.outputKey, 'ukhsa-country-hepb:serology')
  })

  it('quotes the migrant health guide verbatim', () => {
    // Transcribed from https://www.gov.uk/guidance/hepatitis-b-migrant-health-guide
    // on 2026-09-12, under "Testing". OGL v3.0. Changing either line means
    // re-reading the source.
    assert.deepEqual(rule.citations, [
      {
        url: 'https://www.gov.uk/guidance/hepatitis-b-migrant-health-guide',
        quote:
          'People whose only identified risk factor for hepatitis B is country of birth should have testing offered and arranged by GPs.',
      },
      {
        url: 'https://www.gov.uk/guidance/hepatitis-b-migrant-health-guide',
        quote:
          'Diagnoses of hepatitis B virus is based on serological markers (antigens and antibodies) in plasma or serum.',
      },
    ])
  })
})
