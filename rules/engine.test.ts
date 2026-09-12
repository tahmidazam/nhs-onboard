import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyRules } from './engine'
import type { PatientProfile, ProfileFact, Rule, RuleOutcome } from './types'

/**
 * The engine. See #13 and docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 *
 * Every assertion is on the outcomes returned, never on how the engine got there.
 */

function fact(over: Partial<ProfileFact> = {}): ProfileFact {
  return {
    key: 'diabetes',
    verbatim: 'diabetes',
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'd1', quote: 'diabetes' },
    synthesised: false,
    ...over,
  }
}

function profile(over: Partial<PatientProfile> = {}): PatientProfile {
  return {
    patientId: 'p1',
    asOf: '2026-09-12T08:00:00Z',
    ageYears: 52,
    ageMonths: 629,
    country: 'BD',
    conditions: [],
    medications: [],
    allergies: [],
    immunisations: [],
    ...over,
  }
}

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'test-rule',
    kind: 'screening',
    target: 'referrals',
    citations: [{ url: 'https://www.gov.uk/guidance/bowel-cancer-screening-programme-overview', quote: 'Bowel cancer screening' }],
    countries: 'all',
    priority: 2,
    reads: 'Nothing. A fixture.',
    evaluate: () => [],
    ...over,
  }
}

function recommends(outcomes: RuleOutcome[]): Partial<Rule> {
  return { evaluate: () => outcomes }
}

const oneRec: RuleOutcome = {
  kind: 'recommendation',
  outputKey: 'test-rule:only',
  title: 'Refer for bowel screening',
  rationale: 'Aged 52',
  consumed: [fact()],
}

describe('applyRules', () => {
  it('assembles a recommendation from the rule metadata, not the outcome', () => {
    const emitted = applyRules(profile(), [rule({ kind: 'referral', target: 'diagnostics', ...recommends([oneRec]) })])

    assert.equal(emitted.length, 1)
    assert.deepEqual(emitted[0], {
      kind: 'recommendation',
      ruleId: 'test-rule',
      outputKey: 'test-rule:only',
      rec: {
        kind: 'referral',
        title: 'Refer for bowel screening',
        rationale: 'Aged 52',
        confidence: 'document-evidenced',
        evidence: [{ kind: 'document', id: 'd1', quote: 'diabetes' }],
        citation: {
          url: 'https://www.gov.uk/guidance/bowel-cancer-screening-programme-overview',
          quote: 'Bowel cancer screening',
        },
        target: 'diagnostics',
        ruleId: 'test-rule',
        outputKey: 'test-rule:only',
        synthesised: false,
      },
    })
  })

  it('assembles a gap carrying its rule id and priority', () => {
    const emitted = applyRules(
      profile(),
      [
        rule({
          id: 'ukhsa-imm-primary-course',
          priority: 1,
          ...recommends([
            {
              kind: 'gap',
              outputKey: 'ukhsa-imm-primary-course:card',
              question: 'Do you have a vaccination card at home?',
              consumed: [],
            },
          ]),
        }),
      ],
    )

    assert.deepEqual(emitted, [
      {
        kind: 'gap',
        ruleId: 'ukhsa-imm-primary-course',
        outputKey: 'ukhsa-imm-primary-course:card',
        gap: {
          question: 'Do you have a vaccination card at home?',
          ruleId: 'ukhsa-imm-primary-course',
          outputKey: 'ukhsa-imm-primary-course:card',
          synthesised: false,
          priority: 1,
        },
      },
    ])
  })

  it('runs a rule gated to the patient country and skips one gated elsewhere', () => {
    const emitted = applyRules(profile({ country: 'BD' }), [
      rule({ id: 'hepb', countries: ['BD', 'IN'], ...recommends([{ ...oneRec, outputKey: 'hepb:serology' }]) }),
      rule({ id: 'elsewhere', countries: ['UA'], ...recommends([{ ...oneRec, outputKey: 'elsewhere:only' }]) }),
      rule({ id: 'everyone', countries: 'all', ...recommends([{ ...oneRec, outputKey: 'everyone:only' }]) }),
    ])

    assert.deepEqual(emitted.map((o) => o.ruleId).sort(), ['everyone', 'hepb'])
  })

  it('returns nothing for a rule that does not apply', () => {
    assert.deepEqual(applyRules(profile(), [rule()]), [])
  })

  it('gives a recommendation the weakest bucket under it', () => {
    const mixed = [
      fact({ key: 'age', confidence: 'document-evidenced' }),
      fact({ key: 'napa', confidence: 'uncertain-mapping' }),
      fact({ key: 'card', confidence: 'patient-reported' }),
    ]

    const emitted = applyRules(profile(), [rule(recommends([{ ...oneRec, consumed: mixed }]))])

    assert.equal(emitted[0]?.kind === 'recommendation' && emitted[0].rec.confidence, 'uncertain-mapping')
  })

  it('takes the weakest bucket even when the weakest fact is read first', () => {
    const emitted = applyRules(profile(), [
      rule(
        recommends([
          {
            ...oneRec,
            consumed: [
              fact({ key: 'card', confidence: 'patient-reported' }),
              fact({ key: 'age', confidence: 'document-evidenced' }),
            ],
          },
        ]),
      ),
    ])

    assert.equal(emitted[0]?.kind === 'recommendation' && emitted[0].rec.confidence, 'patient-reported')
  })

  it('lists the source of every consumed fact as the evidence chain', () => {
    const emitted = applyRules(profile(), [
      rule(
        recommends([
          {
            ...oneRec,
            consumed: [
              fact({ source: { kind: 'sim-record', id: 'p1', quote: 'aged 52' } }),
              fact({ source: { kind: 'transcript', id: 'call-7', quote: 'I had measles jabs' } }),
            ],
          },
        ]),
      ),
    ])

    assert.deepEqual(emitted[0]?.kind === 'recommendation' && emitted[0].rec.evidence, [
      { kind: 'sim-record', id: 'p1', quote: 'aged 52' },
      { kind: 'transcript', id: 'call-7', quote: 'I had measles jabs' },
    ])
  })

  it('falls back to the declared floor when the rule consumed nothing', () => {
    const emitted = applyRules(profile(), [
      rule({
        confidenceFloor: 'patient-reported',
        ...recommends([{ ...oneRec, consumed: [] }]),
      }),
    ])

    assert.equal(emitted[0]?.kind === 'recommendation' && emitted[0].rec.confidence, 'patient-reported')
    assert.deepEqual(emitted[0]?.kind === 'recommendation' && emitted[0].rec.evidence, [])
  })

  it('throws naming the rule when it consumed nothing and declares no floor', () => {
    assert.throws(
      () =>
        applyRules(profile(), [
          rule({ id: 'floorless-rule', ...recommends([{ ...oneRec, consumed: [] }]) }),
        ]),
      /floorless-rule/,
    )
  })

  it('propagates synthesised from any one consumed fact to the outcome', () => {
    const emitted = applyRules(profile(), [
      rule(
        recommends([
          {
            ...oneRec,
            consumed: [fact({ key: 'age' }), fact({ key: 'measles', synthesised: true })],
          },
          {
            kind: 'gap',
            outputKey: 'test-rule:card',
            question: 'How old were you at that dose?',
            consumed: [fact({ key: 'measles', synthesised: true })],
          },
        ]),
      ),
    ])

    assert.deepEqual(
      emitted.map((o) => (o.kind === 'recommendation' ? o.rec.synthesised : o.gap.synthesised)),
      [true, true],
    )
  })

  it('leaves synthesised false when no consumed fact is synthesised', () => {
    const emitted = applyRules(profile(), [rule(recommends([oneRec]))])

    assert.equal(emitted[0]?.kind === 'recommendation' && emitted[0].rec.synthesised, false)
  })

  it('keeps the rule primary citation when an outcome adds secondary ones', () => {
    const emitted = applyRules(profile(), [
      rule({
        citations: [{ url: 'https://www.gov.uk/primary', quote: 'The primary line' }],
        ...recommends([
          {
            ...oneRec,
            extraCitations: [{ url: 'https://www.gov.uk/country-guide', quote: 'The country guide line' }],
          },
        ]),
      }),
    ])

    assert.deepEqual(emitted[0]?.kind === 'recommendation' && emitted[0].rec.citation, {
      url: 'https://www.gov.uk/primary',
      quote: 'The primary line',
    })
  })

  it('produces the same outcome set for a shuffled pack', () => {
    const pack = [
      rule({ id: 'a', ...recommends([{ ...oneRec, outputKey: 'a:one' }]) }),
      rule({ id: 'b', confidenceFloor: 'patient-reported', ...recommends([{ ...oneRec, outputKey: 'b:one', consumed: [] }]) }),
      rule({ id: 'c', ...recommends([{ kind: 'gap', outputKey: 'c:one', question: 'Anything?', consumed: [fact()] }]) }),
      rule({ id: 'd', countries: ['UA'], ...recommends([{ ...oneRec, outputKey: 'd:one' }]) }),
    ]

    const asWritten = applyRules(profile(), pack)
    const reversed = applyRules(profile(), [...pack].reverse())
    const rotated = applyRules(profile(), [pack[2]!, pack[0]!, pack[3]!, pack[1]!])

    const set = (out: ReturnType<typeof applyRules>) =>
      [...out].sort((x, y) => x.outputKey.localeCompare(y.outputKey))

    assert.deepEqual(set(reversed), set(asWritten))
    assert.deepEqual(set(rotated), set(asWritten))
  })

  it('collapses two outcomes sharing one outputKey to one', () => {
    const emitted = applyRules(profile(), [
      rule(
        recommends([
          { ...oneRec, outputKey: 'test-rule:dose-2', title: 'Top-up dose' },
          { ...oneRec, outputKey: 'test-rule:dose-2', title: 'Top-up dose' },
        ]),
      ),
    ])

    assert.equal(emitted.length, 1)
    assert.equal(emitted[0]?.outputKey, 'test-rule:dose-2')
  })

  it('runs every rule in the pack, with none suppressing another', () => {
    const emitted = applyRules(profile(), [
      rule({ id: 'first', ...recommends([{ ...oneRec, outputKey: 'first:one' }]) }),
      rule({ id: 'second', ...recommends([{ ...oneRec, outputKey: 'second:one' }]) }),
      rule({ id: 'third', ...recommends([{ ...oneRec, outputKey: 'third:one' }, { ...oneRec, outputKey: 'third:two' }]) }),
    ])

    assert.deepEqual(emitted.map((o) => o.outputKey).sort(), [
      'first:one',
      'second:one',
      'third:one',
      'third:two',
    ])
  })
})
