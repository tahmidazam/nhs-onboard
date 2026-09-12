import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rule } from './nhs-general-history'
import { pack } from './index'
import type { PatientProfile, ProfileFact, RuleOutcome } from './types'

/**
 * Profiles are built by hand rather than through buildProfile, so these assert
 * the rule rather than the projection.
 */

const AS_OF = '2026-09-12T08:00:00Z'

/** convex/lib/degradeRecord.ts, when no condition survives the draw. */
const DEGRADER_HISTORY = 'No further history recorded at this visit.'

/** convex/lib/degradeRecord.ts, when no medication survives the draw. */
const DEGRADER_MEDICATIONS =
  'Patient reports taking regular medication abroad but could not name it.'

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

function keys(overrides: Partial<PatientProfile> = {}): string[] {
  return rule.evaluate(profile(overrides)).map((o) => o.outputKey).sort()
}

function gapFor(slug: string, overrides: Partial<PatientProfile> = {}) {
  const outcome: RuleOutcome | undefined = rule
    .evaluate(profile(overrides))
    .find((o) => o.outputKey === `nhs-general-history:${slug}`)
  if (outcome?.kind !== 'gap') throw new Error(`no gap for ${slug}`)
  return outcome
}

describe('nhs-general-history on a record that says nothing', () => {
  it('asks all four sections', () => {
    assert.deepEqual(keys(), [
      'nhs-general-history:dh',
      'nhs-general-history:fh',
      'nhs-general-history:pmh',
      'nhs-general-history:sh',
    ])
  })
})

describe('what makes a section thin', () => {
  it('drops the PMH gap when a condition states something', () => {
    assert.deepEqual(keys({ conditions: [fact('Known diagnosis: Type 2 diabetes mellitus.')] }), [
      'nhs-general-history:dh',
      'nhs-general-history:fh',
      'nhs-general-history:sh',
    ])
  })

  it('drops the DH gap when a medication states something', () => {
    assert.ok(!keys({ medications: [fact('Napa 500mg')] }).includes('nhs-general-history:dh'))
  })

  it('drops the FH gap when a family history fact states something', () => {
    assert.ok(
      !keys({ familyHistory: [fact('Father: heart attack at 58')] }).includes(
        'nhs-general-history:fh',
      ),
    )
  })

  it('is decided per section rather than by a count across the record', () => {
    // A record carrying nine conditions and no medicines is full in one section
    // and empty in another, and a global threshold would call it full. There is
    // no threshold here to tune: the section either says something or it does
    // not, which is ADR 3's refusal of a number applied one layer up.
    const nine = Array.from({ length: 9 }, (_, i) => fact(`Known diagnosis: condition ${i + 1}.`))

    assert.deepEqual(keys({ conditions: nine }), [
      'nhs-general-history:dh',
      'nhs-general-history:fh',
      'nhs-general-history:sh',
    ])
  })

  it('treats one stated fact as enough, so the rule has no dial to defend', () => {
    assert.deepEqual(
      keys({ conditions: [fact('Asthma')] }),
      keys({ conditions: [fact('Asthma'), fact('Essential hypertension')] }),
    )
  })

  it('counts a section filled with the degrader sentence as thin', () => {
    // The reason it reads `stated` rather than `length`. Extraction reads the
    // filler sentence back as a claim, so the array is non-empty and the record
    // still says nothing. See rules/negation.ts.
    assert.deepEqual(
      keys({ conditions: [fact(DEGRADER_HISTORY)], medications: [fact(DEGRADER_MEDICATIONS)] }),
      [
        'nhs-general-history:dh',
        'nhs-general-history:fh',
        'nhs-general-history:pmh',
        'nhs-general-history:sh',
      ],
    )
  })
})

describe('the social history gap', () => {
  it('fires whatever the record holds', () => {
    const full = {
      conditions: [fact('Asthma')],
      medications: [fact('Napa 500mg')],
      allergies: [fact('Penicillin')],
      familyHistory: [fact('Mother: diabetes')],
    }

    assert.deepEqual(keys(full), ['nhs-general-history:sh'])
  })

  it('consumes nothing, because no claim can carry a social history', () => {
    // ClaimKind is medication, condition, immunisation, family-history, allergy.
    // Nothing in it holds smoking, alcohol, occupation or carer status, so there
    // is no section to find thin and nothing to consume when it fires.
    assert.deepEqual(gapFor('sh').consumed, [])
  })

  it('says so in `reads`, rather than leaving it to be inferred from the code', () => {
    assert.match(rule.reads, /no ClaimKind for smoking, alcohol, occupation or carer status/)
  })

  it('names no ClaimKind that could have answered it', () => {
    const kinds = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')
    assert.match(kinds, /export type ClaimKind = /)
    for (const kind of ['smoking', 'alcohol', 'occupation', 'carer', 'social']) {
      assert.ok(
        !new RegExp(`ClaimKind =[^\\n]*${kind}`).test(kinds),
        `ClaimKind gained ${kind}, so the social history gap can now be thin-tested like the rest`,
      )
    }
  })
})

describe('the gaps each section asks', () => {
  it('consumes the section it read, negatives included', () => {
    const negative = fact(DEGRADER_HISTORY)
    assert.deepEqual(gapFor('pmh', { conditions: [negative] }).consumed, [negative])
  })

  it('asks one topic per gap, tracking the call plan step that collects it', () => {
    assert.match(gapFor('pmh').question, /doctor ever told you/i)
    assert.match(gapFor('dh').question, /medicines do you take/i)
    assert.match(gapFor('fh').question, /parents, brothers and sisters/i)
    assert.match(gapFor('sh').question, /smoke/i)
  })

  it('keeps medicines out of the PMH question and conditions out of the DH one', () => {
    assert.doesNotMatch(gapFor('pmh').question, /medicine|tablet/i)
    assert.doesNotMatch(gapFor('dh').question, /diagnos|condition/i)
  })

  it('asks the medicines question about what was brought from abroad', () => {
    // Call plan step 4: anything they take regularly, including anything brought
    // from abroad, and anything bought over the counter.
    assert.match(gapFor('dh').question, /abroad/i)
    assert.match(gapFor('dh').question, /without a prescription/i)
  })

  it('accepts an approximate age in the family history question', () => {
    // THE FOUR ANSWER STATES: record the hedge intact, do not push for
    // precision.
    assert.match(gapFor('fh').question, /roughly what age/i)
  })

  it('speaks rather than renders: no markdown, no headings, no newlines', () => {
    for (const outcome of rule.evaluate(profile())) {
      if (outcome.kind !== 'gap') continue
      assert.doesNotMatch(outcome.question, /[*_#|]|\n/, outcome.outputKey)
    }
  })

  it('asks nothing already answerable from the record it read', () => {
    // The prompt tells the agent not to re-ask what the records hold, so a gap
    // must not fire on a section that already states something.
    const outcomes = rule.evaluate(
      profile({
        conditions: [fact('Asthma')],
        medications: [fact('Napa 500mg')],
        familyHistory: [fact('Mother: diabetes')],
      }),
    )

    assert.deepEqual(outcomes.map((o) => o.outputKey), ['nhs-general-history:sh'])
  })
})

describe('nhs-general-history in the pack', () => {
  it('declares priority 3 and sits last, so it fills a call behind everything else', () => {
    assert.equal(rule.priority, 3)
    assert.equal(pack[pack.length - 1]?.id, 'nhs-general-history')
  })

  it('declares no confidenceFloor, because a gap derives no bucket', () => {
    assert.equal(rule.confidenceFloor, undefined)
  })

  it('fires for every country', () => {
    assert.equal(rule.countries, 'all')
  })

  it('keys every gap stably, so a re-run updates rather than duplicates', () => {
    const profileOnce = profile()
    assert.deepEqual(
      rule.evaluate(profileOnce).map((o) => o.outputKey),
      rule.evaluate(profileOnce).map((o) => o.outputKey),
    )
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
