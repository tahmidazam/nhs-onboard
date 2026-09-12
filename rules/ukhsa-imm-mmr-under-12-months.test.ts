import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { rule } from './ukhsa-imm-mmr-under-12-months'
import type { ImmunisationFact, PatientProfile } from './types'

/**
 * The clinical specification for #15's second rule. Fixtures are built by hand
 * rather than through rules/profile.ts, so this asserts the rule and not the
 * projection.
 */

const ASOF = '2026-09-12T08:00:00Z'

function dose(over: Partial<ImmunisationFact> = {}): ImmunisationFact {
  return {
    key: 'mmr',
    verbatim: 'MMR',
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: 'MMR' },
    synthesised: false,
    ...over,
  }
}

/**
 * The birthDate that many whole months before the clock, on the same day of
 * month, so a fixture's age and its birthDate state the same thing.
 */
function bornMonthsBefore(ageMonths: number): string {
  const clock = new Date(ASOF)
  return new Date(
    Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() - ageMonths, clock.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)
}

function profile(over: Partial<PatientProfile> = {}): PatientProfile {
  return {
    patientId: 'SIM-000001',
    birthDate: bornMonthsBefore(over.ageMonths ?? 55),
    asOf: ASOF,
    ageYears: 4,
    ageMonths: 55,
    country: 'BD',
    conditions: [],
    medications: [],
    allergies: [],
    immunisations: [],
    ...over,
  }
}

describe('ukhsa-imm-mmr-under-12-months', () => {
  it('emits a top-up for a measles-containing dose given at 9 months', () => {
    const given = dose({ ageAtDoseMonths: 9 })
    const outcomes = rule.evaluate(profile({ immunisations: [given] }))

    assert.equal(outcomes.length, 1)
    const [outcome] = outcomes
    assert.equal(outcome.kind, 'recommendation')
    assert.equal(outcome.outputKey, 'ukhsa-imm-mmr-under-12-months:top-up')
    assert.deepEqual(outcome.consumed, [given], 'the discounted dose is the evidence')
  })

  it('asks for two valid doses when none of the recorded doses count', () => {
    const outcomes = rule.evaluate(profile({ immunisations: [dose({ ageAtDoseMonths: 9 })] }))
    assert.ok(outcomes[0].kind === 'recommendation' && outcomes[0].title.includes('2 doses'))
  })

  it('asks for one further dose when one recorded dose already counts', () => {
    const outcomes = rule.evaluate(
      profile({
        immunisations: [dose({ ageAtDoseMonths: 9 }), dose({ ageAtDoseMonths: 15 })],
      }),
    )
    assert.equal(outcomes.length, 1)
    assert.ok(outcomes[0].kind === 'recommendation' && outcomes[0].title.includes('1 dose'))
  })

  it('emits nothing when two recorded doses already count, discounted dose or not', () => {
    const outcomes = rule.evaluate(
      profile({
        immunisations: [
          dose({ ageAtDoseMonths: 9 }),
          dose({ ageAtDoseMonths: 15 }),
          dose({ ageAtDoseMonths: 43 }),
        ],
      }),
    )
    assert.deepEqual(outcomes, [], 'the source asks for two valid doses, not two top-ups')
  })

  it('emits nothing for a dose given at 13 months', () => {
    const outcomes = rule.evaluate(profile({ immunisations: [dose({ ageAtDoseMonths: 13 })] }))
    assert.deepEqual(outcomes, [])
  })

  it('emits nothing for a dose given at exactly 12 months', () => {
    const outcomes = rule.evaluate(profile({ immunisations: [dose({ ageAtDoseMonths: 12 })] }))
    assert.deepEqual(outcomes, [], 'the source discounts doses prior to 12 months, not at 12')
  })

  it('emits a gap, not a recommendation, when the dose age is not precise enough to tell', () => {
    const vague = dose({ verbatim: 'measles vaccine, as a child', ageAtDoseMonths: undefined })
    const outcomes = rule.evaluate(profile({ immunisations: [vague] }))

    assert.equal(outcomes.length, 1)
    const [outcome] = outcomes
    assert.equal(outcome.kind, 'gap')
    assert.equal(outcome.outputKey, 'ukhsa-imm-mmr-under-12-months:dose-1:age')
    assert.ok(outcome.kind === 'gap' && outcome.question.length > 0)
    assert.deepEqual(outcome.consumed, [vague])
  })

  it('reports the synthesised card it read, so the engine can propagate the label', () => {
    const card = dose({
      ageAtDoseMonths: 9,
      synthesised: true,
      source: { kind: 'document', id: 'card-1', quote: 'MMR - 9 months' },
    })
    const outcomes = rule.evaluate(profile({ immunisations: [card] }))

    assert.equal(outcomes.length, 1)
    assert.ok(outcomes[0].consumed.every((fact) => fact.synthesised))
  })

  it('ignores immunisations that contain no measles, mumps, rubella or varicella component', () => {
    const outcomes = rule.evaluate(
      profile({
        immunisations: [dose({ key: 'bcg', verbatim: 'BCG', ageAtDoseMonths: 1 })],
      }),
    )
    assert.deepEqual(outcomes, [])
  })

  it('numbers each measles-containing dose, so two vague doses do not collide', () => {
    const outcomes = rule.evaluate(
      profile({
        immunisations: [
          dose({ verbatim: 'measles, as a child' }),
          dose({ key: 'mmrv', verbatim: 'MMRV, unknown date' }),
        ],
      }),
    )

    assert.deepEqual(
      outcomes.map((o) => o.outputKey),
      [
        'ukhsa-imm-mmr-under-12-months:dose-1:age',
        'ukhsa-imm-mmr-under-12-months:dose-2:age',
      ],
    )
  })

  it('names MMRV for a child born on or after 1 January 2020 and MMR before it', () => {
    // asOf is 2026-09-12, so 55 months puts the birthday in 2022 and 96 in 2018.
    const from2020 = rule.evaluate(
      profile({ ageYears: 4, ageMonths: 55, immunisations: [dose({ ageAtDoseMonths: 9 })] }),
    )
    const pre2020 = rule.evaluate(
      profile({ ageYears: 8, ageMonths: 96, immunisations: [dose({ ageAtDoseMonths: 9 })] }),
    )

    assert.ok(from2020[0].kind === 'recommendation' && from2020[0].title.includes('MMRV'))
    assert.ok(pre2020[0].kind === 'recommendation' && !pre2020[0].title.includes('MMRV'))
    assert.ok(pre2020[0].kind === 'recommendation' && pre2020[0].title.includes('MMR'))
  })

  it('defers the top-up to the first birthday for an infant still under one', () => {
    const outcomes = rule.evaluate(
      profile({ ageYears: 0, ageMonths: 9, immunisations: [dose({ ageAtDoseMonths: 6 })] }),
    )
    assert.ok(
      outcomes[0].kind === 'recommendation' &&
        outcomes[0].title.includes('from the first birthday'),
      'the UK schedule counts MMR from the first birthday onwards',
    )
  })

  it('carries the verbatim source line the rule rests on', () => {
    assert.ok(
      rule.citations.some((c) =>
        c.quote.includes('given prior to 12 months of age should not be counted'),
      ),
    )
    for (const citation of rule.citations) assert.ok(!citation.quote.includes('TODO'))
  })
})
