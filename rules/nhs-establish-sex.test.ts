import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rule } from './nhs-establish-sex'
import { pack } from './index'
import type { PatientProfile, ProfileFact, RuleOutcome } from './types'

/**
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rule rather than the projection.
 */

const AS_OF = '2026-09-12T08:00:00Z'

function fact(verbatim: string): ProfileFact {
  return {
    key: verbatim.toLowerCase().replace(/[^a-z0-9]/g, ''),
    verbatim,
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

describe('nhs-establish-sex', () => {
  it('asks when nothing has established a sex', () => {
    const outcomes = rule.evaluate(profile())

    assert.equal(outcomes.length, 1)
    assert.equal(gap(outcomes[0]).outputKey, 'nhs-establish-sex:sex')
  })

  it('stays quiet once a sex is on the patient row', () => {
    assert.deepEqual(rule.evaluate(profile({ sex: 'female' })), [])
    assert.deepEqual(rule.evaluate(profile({ sex: 'male' })), [])
  })

  it('reads the gate and nothing else about the record', () => {
    // The severe degradation this fires on: every condition line gone, so no
    // pronoun survived for ADR 20 to read back. A record with conditions and no
    // sex still asks, because the pronoun is what carried it, not the condition.
    assert.equal(rule.evaluate(profile({ conditions: [fact('Asthma')] })).length, 1)
    assert.equal(
      rule.evaluate(profile({ sex: 'male', conditions: [fact('Asthma')] })).length,
      0,
    )
  })

  it('consumes nothing, because sex is a gate and not evidence', () => {
    // It is not in `truth`, and it carries its own provenance on the patient
    // row. Consuming it would launder a read-back pronoun into an outcome's
    // evidence chain. See ADR 20 and rules/types.ts.
    assert.deepEqual(gap(rule.evaluate(profile())[0]).consumed, [])
  })

  it('puts sex in no rule module\'s consumed list anywhere in the pack', () => {
    // Held across the pack rather than on this rule alone, because the gate is
    // readable by every rule and the prohibition is on all of them.
    const dir = new URL('.', import.meta.url)
    for (const name of ['nhs-establish-sex.ts', 'nhs-general-history.ts', 'nhs-ask-allergies.ts']) {
      const source = readFileSync(new URL(name, dir), 'utf8')
      assert.ok(
        !/consumed:\s*\[[^\]]*sex/.test(source),
        `rules/${name} consumes a sex, which has no SourceRef to carry`,
      )
    }
  })

  it('declares no confidenceFloor, because a gap derives no bucket', () => {
    // rules/engine.ts returns for `kind: 'gap'` before it reads
    // `rule.confidenceFloor`, so a floor here would be a value nothing reads,
    // rendered on /rules under a caption about inheriting from claims. ADR 14's
    // floor exists for a recommendation that consumed no fact, and this rule
    // emits none.
    assert.equal(rule.confidenceFloor, undefined)
    assert.deepEqual(
      rule.evaluate(profile()).filter((o) => o.kind === 'recommendation'),
      [],
    )
  })

  it('asks plainly, and says why, without reading the record back', () => {
    const { question } = gap(rule.evaluate(profile())[0])

    assert.match(question, /male or female/i)
    // Call plan step 11: the screening offered follows from the answer given.
    assert.match(question, /checks the NHS offers depend on it/i)
    // Never a confirmation, and never a guess put to the patient to agree with.
    assert.doesNotMatch(question, /is that right|we have you as|our records say you are/i)
  })

  it('never asks about a name, which ADR 9 refuses to infer from', () => {
    const { question } = gap(rule.evaluate(profile())[0])

    assert.doesNotMatch(question, /\bname\b/i)
    assert.match(rule.reads, /Never the name/)
  })

  it('speaks rather than renders: no markdown, no lists, no newlines', () => {
    assert.doesNotMatch(gap(rule.evaluate(profile())[0]).question, /[*_#|]|\n/)
  })

  it('fills the call in the first tier, because it gates what step 11 offers', () => {
    // Asked late, the answer arrives after the screening questions it decides.
    assert.equal(rule.priority, 1)
    assert.equal(pack[1]?.id, 'nhs-establish-sex')
  })

  it('fires for every country', () => {
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
