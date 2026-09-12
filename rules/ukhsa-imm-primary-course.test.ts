import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { rule } from './ukhsa-imm-primary-course'
import type { ImmunisationFact, PatientProfile, RuleOutcome } from './types'

/**
 * The clinical specification for #15's first rule. The age bands and the
 * four-week interval are checked against the UKHSA algorithm line by line, so
 * these assertions are the encoding of the source rather than of the code.
 *
 * Fixtures are built by hand rather than through rules/profile.ts, so this
 * asserts the rule and not the projection.
 */

const ASOF = '2026-09-12T08:00:00Z'

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
    birthDate: bornMonthsBefore(over.ageMonths ?? 412),
    asOf: ASOF,
    ageYears: 34,
    ageMonths: 412,
    country: 'BD',
    conditions: [],
    medications: [],
    allergies: [],
    familyHistory: [],
    immunisations: [],
    ...over,
  }
}

function dose(over: Partial<ImmunisationFact> = {}): ImmunisationFact {
  return {
    key: 'dtap-ipv-hib-hepb',
    verbatim: 'DTaP/IPV/Hib/HepB',
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'card-1', quote: 'DTaP/IPV/Hib/HepB' },
    synthesised: false,
    ...over,
  }
}

function recommendation(outcomes: RuleOutcome[]) {
  const rec = outcomes.find((outcome) => outcome.kind === 'recommendation')
  if (rec?.kind !== 'recommendation') throw new Error('expected a recommendation')
  return rec
}

function gap(outcomes: RuleOutcome[]) {
  const found = outcomes.find((outcome) => outcome.kind === 'gap')
  if (found?.kind !== 'gap') throw new Error('expected a gap')
  return found
}

function titleAt(ageYears: number, ageMonths: number): string {
  return recommendation(rule.evaluate(profile({ ageYears, ageMonths }))).title
}

describe('ukhsa-imm-primary-course', () => {
  it('emits a recommendation and a gap together for a patient with no immunisations', () => {
    const outcomes = rule.evaluate(profile())

    assert.deepEqual(
      outcomes.map((o) => o.kind),
      ['recommendation', 'gap'],
      'planning the course and asking for a card are not alternatives',
    )
    assert.equal(outcomes[0].outputKey, 'ukhsa-imm-primary-course:plan')
    assert.equal(outcomes[1].outputKey, 'ukhsa-imm-primary-course:card')
  })

  it('emits at least one outcome at every age, so no patient screen is empty', () => {
    const ages: [number, number][] = [
      [0, 1],
      [0, 3],
      [0, 11],
      [1, 14],
      [2, 26],
      [8, 100],
      [17, 209],
      [34, 412],
      [52, 630],
      [67, 810],
      [80, 966],
    ]
    for (const [ageYears, ageMonths] of ages) {
      const outcomes = rule.evaluate(profile({ ageYears, ageMonths }))
      assert.ok(outcomes.length > 0, `no outcome at ${ageYears}y`)
    }
  })

  it('plans three doses a minimum of four weeks apart', () => {
    const title = titleAt(34, 412)
    assert.ok(title.includes('3 doses'), title)
    assert.ok(title.includes('4-week'), title)
  })

  it('selects the infant ladder from 8 weeks of age up to the first birthday', () => {
    const title = titleAt(0, 3)
    assert.ok(title.includes('Infants from 8 weeks of age up to first birthday'), title)
    assert.ok(title.includes('visit 1: DTaP/IPV/Hib/HepB, MenB, rotavirus'), title)
    assert.ok(title.includes('visit 2: DTaP/IPV/Hib/HepB, MenB, rotavirus'), title)
    assert.ok(title.includes('visit 3: DTaP/IPV/Hib/HepB, PCV13'), title)
  })

  it('notes that the ladder starts at 8 weeks for an infant younger than that', () => {
    const title = titleAt(0, 1)
    assert.ok(title.includes('from 8 weeks of age'), title)
  })

  it('selects the first-to-second-birthday ladder, which carries MMRV', () => {
    const title = titleAt(1, 14)
    assert.ok(title.includes('Children from first up to second birthday'), title)
    assert.ok(title.includes('visit 1: DTaP/IPV/Hib/HepB, PCV13, MenB, MMRV'), title)
    assert.ok(title.includes('visit 2: DTaP/IPV/Hib/HepB, MenB'), title)
    assert.ok(title.includes('visit 3: DTaP/IPV/Hib/HepB'), title)
  })

  it('selects the second-to-10th-birthday ladder', () => {
    const title = titleAt(2, 26)
    assert.ok(title.includes('Children from second up to 10th birthday'), title)
    assert.ok(title.includes('visit 1: DTaP/IPV/Hib/HepB, MMR or MMRV'), title)
    assert.ok(title.includes('visit 2: DTaP/IPV/Hib/HepB, MMR or MMRV'), title)
    assert.ok(title.includes('visit 3: DTaP/IPV/Hib/HepB'), title)
    assert.equal(titleAt(9, 119).includes('Children from second up to 10th birthday'), true)
  })

  it('selects the adult ladder from the 10th birthday onwards', () => {
    const title = titleAt(10, 120)
    assert.ok(title.includes('From 10th birthday onwards'), title)
    assert.ok(title.includes('visit 1: Td/IPV, MenACWY, MMR'), title)
    assert.ok(title.includes('visit 2: Td/IPV, MMR'), title)
    assert.ok(title.includes('visit 3: Td/IPV'), title)
    assert.equal(titleAt(80, 966).includes('From 10th birthday onwards'), true)
  })

  it('resumes a started course rather than restarting it', () => {
    const given = dose()
    const outcomes = rule.evaluate(profile({ ageYears: 34, ageMonths: 412, immunisations: [given] }))
    const rec = recommendation(outcomes)

    assert.ok(rec.title.startsWith('Resume'), rec.title)
    assert.ok(rec.title.includes('2 doses'), rec.title)
    assert.ok(rec.title.includes('visit 2'), rec.title)
    assert.ok(!rec.title.includes('visit 1'), 'a resumed course does not repeat doses')
    assert.deepEqual(rec.consumed, [given], 'the doses already given are the evidence')
  })

  it('resumes from the highest recorded dose number, not the count of records', () => {
    const outcomes = rule.evaluate(
      profile({ immunisations: [dose({ verbatim: 'DTP, 2nd dose', doseNumber: 2 })] }),
    )
    const rec = recommendation(outcomes)
    assert.ok(rec.title.includes('1 dose'), rec.title)
    assert.ok(rec.title.includes('visit 3'), rec.title)
  })

  it('plans no further doses once three are recorded, and still asks for the card', () => {
    const outcomes = rule.evaluate(
      profile({
        immunisations: [
          dose({ doseNumber: 1 }),
          dose({ doseNumber: 2 }),
          dose({ doseNumber: 3 }),
        ],
      }),
    )

    assert.deepEqual(
      outcomes.map((o) => o.kind),
      ['gap'],
      'a documented complete course needs no plan',
    )
  })

  it('counts only the diphtheria, tetanus, pertussis and polio ladder', () => {
    const outcomes = rule.evaluate(
      profile({
        immunisations: [
          dose({ key: 'mmr', verbatim: 'MMR' }),
          dose({ key: 'bcg', verbatim: 'BCG' }),
          dose({ key: 'hepb', verbatim: 'Hepatitis B, birth dose' }),
        ],
      }),
    )
    const rec = recommendation(outcomes)
    assert.ok(rec.title.startsWith('Plan'), rec.title)
    assert.ok(rec.title.includes('3 doses'), rec.title)
    assert.deepEqual(rec.consumed, [], 'nothing on this card belongs to the primary course')
  })

  it('reports the synthesised card it read, so the engine can propagate the label', () => {
    const card = dose({
      synthesised: true,
      source: { kind: 'document', id: 'card-1', quote: 'DTP x1' },
    })
    const rec = recommendation(rule.evaluate(profile({ immunisations: [card] })))
    assert.ok(rec.consumed.length > 0 && rec.consumed.every((fact) => fact.synthesised))
  })

  it('consumes no fact from an empty record, so ADR 14 applies the floor', () => {
    for (const outcome of rule.evaluate(profile())) assert.deepEqual(outcome.consumed, [])
    assert.equal(rule.confidenceFloor, 'patient-reported')
  })

  it('asks the patient for a card or a clinic rather than guessing', () => {
    assert.match(gap(rule.evaluate(profile())).question, /vaccination card|record|clinic/i)
  })

  it('fires for every country and fills a call first', () => {
    assert.equal(rule.countries, 'all')
    assert.equal(rule.priority, 1)
    assert.equal(rule.target, 'gp')
    assert.equal(rule.kind, 'immunisation')
  })

  it('carries the governing principle verbatim', () => {
    assert.equal(
      rule.citations[0].quote,
      'unless there is a documented or reliable verbal vaccine history, individuals should be assumed to be unimmunised and a full course of immunisations planned',
    )
    for (const citation of rule.citations) assert.ok(!citation.quote.includes('TODO'))
  })
})
