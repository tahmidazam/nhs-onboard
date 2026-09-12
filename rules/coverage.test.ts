import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import type { RecoveryMetric } from '../src/types'
import { applyRules } from './engine'
import { pack } from './index'
import {
  CARD_DOCUMENT_ID,
  RECORD_DOCUMENT_ID,
  SPREAD,
  TRANSCRIPT_ID,
  profileFor,
  profileFrom,
} from './coverage.fixtures'
import type { EmittedOutcome, NewGap, NewRecommendation, PatientProfile } from './types'

/**
 * Coverage over a spread of patients, and the pack-wide invariants. See #20.
 *
 * ADR 12 forbids curating the patient, so a pack that is clinically correct and
 * fires nothing on a 34-year-old with hypertension is a dead demo. Two rules
 * fire on every patient by construction, and this file is what keeps that true
 * as the pack changes.
 *
 * Every assertion is on the outcomes the pack returned. Nothing here touches the
 * network, Convex or a model.
 */

describe('the pack over a spread of patients', () => {
  it('derives the age every fixture claims from its birthDate and the frozen clock', () => {
    for (const [index, spread] of SPREAD.entries()) {
      const profile = profileFor(spread, index)
      assert.deepEqual(
        { ageYears: profile.ageYears, ageMonths: profile.ageMonths },
        { ageYears: spread.ageYears, ageMonths: spread.ageMonths },
        `${spread.label}: the birthDate and the age it claims disagree`,
      )
    }
  })

  for (const [index, spread] of SPREAD.entries()) {
    it(`produces at least one outcome for ${spread.label}`, () => {
      const outcomes = applyRules(profileFor(spread, index), pack)
      assert.ok(
        outcomes.length > 0,
        'a judge may nominate this patient, and nothing fired: the review screen would be empty (ADR 12)',
      )
    })
  }

  it('fires both always-on rules for every patient in the spread, whatever the record holds', () => {
    // The two that carry a thin patient. Coverage above would still pass if one
    // of them stopped firing and a screening rule happened to cover the row.
    const alwaysOn = ['ukhsa-imm-primary-course', 'ukhsa-new-arrival-orientation']

    for (const [index, spread] of SPREAD.entries()) {
      const fired = new Set(applyRules(profileFor(spread, index), pack).map((o) => o.ruleId))
      assert.deepEqual(
        alwaysOn.filter((id) => !fired.has(id)),
        [],
        `${spread.label}: a rule that fires by construction did not fire`,
      )
    }
  })

  it('fires every rule in the pack for at least one patient in the spread', () => {
    // A rule that silently never fires looks exactly like a patient who is not
    // eligible. If this goes red the spread is too narrow or the rule is broken,
    // and either way it is worth knowing which.
    const fired = new Set(
      SPREAD.flatMap((spread, index) => applyRules(profileFor(spread, index), pack)).map(
        (o) => o.ruleId,
      ),
    )

    assert.deepEqual(
      pack.map((rule) => rule.id).filter((id) => !fired.has(id)),
      [],
      'no patient in the spread reaches these rules',
    )
  })
})

/**
 * The primary course plan, which consumes every recorded dose on the ladder and
 * so is the pack's widest reader of mixed evidence.
 */
function primaryCoursePlan(profile: PatientProfile): NewRecommendation {
  const emitted = applyRules(profile, pack).find(
    (o) => o.outputKey === 'ukhsa-imm-primary-course:plan',
  )
  if (emitted === undefined || emitted.kind !== 'recommendation') {
    return assert.fail('the primary course rule emitted no plan for this profile')
  }
  return emitted.rec
}

/** Two doses on the primary course ladder, bucketed as the caller asks. */
function twoDoses(
  first: { confidence: NewRecommendation['confidence']; docId: string },
  second: { confidence: NewRecommendation['confidence']; docId: string },
): PatientProfile {
  return profileFrom({
    // 34 as of the frozen clock, and old enough that the ladder is the adult one.
    birthDate: '1992-01-10',
    country: 'BD',
    claims: [
      {
        kind: 'immunisation',
        verbatim: 'DTP, 1992-05-10',
        docId: first.docId,
        sourceKind: first.docId === TRANSCRIPT_ID ? 'transcript' : 'document',
        confidence: first.confidence,
      },
      {
        kind: 'immunisation',
        verbatim: 'Tetanus toxoid, given in 1995',
        docId: second.docId,
        sourceKind: second.docId === TRANSCRIPT_ID ? 'transcript' : 'document',
        confidence: second.confidence,
      },
    ],
  })
}

const EVIDENCED = { confidence: 'document-evidenced' as const, docId: RECORD_DOCUMENT_ID }
const REPORTED = { confidence: 'patient-reported' as const, docId: TRANSCRIPT_ID }
/** ADR 17 demotes a claim whose quote failed containment to this bucket. */
const UNRESOLVED = { confidence: 'uncertain-mapping' as const, docId: RECORD_DOCUMENT_ID }

describe('the bucket a pack recommendation inherits', () => {
  it('gives a recommendation resting on documents alone the evidenced bucket', () => {
    assert.equal(primaryCoursePlan(twoDoses(EVIDENCED, EVIDENCED)).confidence, 'document-evidenced')
  })

  it('drops to patient-reported when one consumed dose came from the call', () => {
    assert.equal(primaryCoursePlan(twoDoses(EVIDENCED, REPORTED)).confidence, 'patient-reported')
  })

  it('drops to uncertain-mapping when one consumed dose could not be resolved', () => {
    assert.equal(primaryCoursePlan(twoDoses(REPORTED, UNRESOLVED)).confidence, 'uncertain-mapping')
  })

  it('takes the weakest bucket whichever order the doses were read in', () => {
    // Minimum-of is pessimistic on purpose: one uncertain claim drags an
    // otherwise evidenced recommendation down a bucket, whether it arrives
    // first or last. See ADR 14.
    assert.equal(primaryCoursePlan(twoDoses(UNRESOLVED, EVIDENCED)).confidence, 'uncertain-mapping')
    assert.equal(primaryCoursePlan(twoDoses(EVIDENCED, UNRESOLVED)).confidence, 'uncertain-mapping')
  })

  it('falls back to the rule floor when the record holds nothing to consume', () => {
    // The thin patient ADR 12 licenses. "We believe you have had no vaccines" is
    // a conversation, not a draft, so the plan stops at patient-reported while
    // orientation, which rests on nothing at all, stays evidenced.
    const thin = profileFrom({ birthDate: '1992-01-10', country: 'BD' })
    const byKey = new Map(
      applyRules(thin, pack)
        .filter((o): o is Extract<EmittedOutcome, { kind: 'recommendation' }> => o.kind === 'recommendation')
        .map((o) => [o.outputKey, o.rec.confidence]),
    )

    assert.equal(byKey.get('ukhsa-imm-primary-course:plan'), 'patient-reported')
    assert.equal(byKey.get('ukhsa-new-arrival-orientation:entitlements'), 'document-evidenced')
  })
})

describe('an outcome resting on the synthesised vaccination card', () => {
  /**
   * A 67-year-old from Ukraine whose only immunisation source is the card ADR 8
   * lets the degrader generate. Bowel screening rests on the sim's own
   * birthDate and orientation on nothing, so one profile shows both halves of
   * the propagation rule.
   */
  const cardOnly = profileFrom({
    birthDate: '1959-06-06',
    country: 'UA',
    claims: [
      { kind: 'immunisation', verbatim: 'Polio (OPV), as a child', docId: CARD_DOCUMENT_ID },
      { kind: 'immunisation', verbatim: 'Measles vaccine, date unknown', docId: CARD_DOCUMENT_ID },
    ],
  })

  const labels = new Map(
    applyRules(cardOnly, pack).map((o) => [
      o.outputKey,
      o.kind === 'recommendation' ? o.rec.synthesised : o.gap.synthesised,
    ]),
  )

  it('labels every outcome that consumed a dose off the card', () => {
    assert.deepEqual(
      {
        plan: labels.get('ukhsa-imm-primary-course:plan'),
        card: labels.get('ukhsa-imm-primary-course:card'),
        measles: labels.get('ukhsa-imm-mmr-under-12-months:dose-1:age'),
      },
      { plan: true, card: true, measles: true },
      'a clinician must never approve an action grounded in a fact the demo invented',
    )
  })

  it('leaves an outcome that consumed nothing off the card unlabelled', () => {
    // Otherwise the label becomes noise and stops meaning anything on screen.
    assert.deepEqual(
      {
        bowel: labels.get('nhs-screen-bowel:invite'),
        orientation: labels.get('ukhsa-new-arrival-orientation:entitlements'),
      },
      { bowel: false, orientation: false },
    )
  })
})

describe('a re-run of the pack on an unchanged profile', () => {
  /** The 34-year-old with a record and a card, which reaches six of the pack's keys. */
  const spec = {
    patientId: 'SIM-000042',
    birthDate: '1992-01-10',
    country: 'BD',
    claims: [
      { kind: 'condition' as const, verbatim: 'Type 2 diabetes mellitus', docId: RECORD_DOCUMENT_ID },
      { kind: 'immunisation' as const, verbatim: 'DTP, 1992-05-10', docId: CARD_DOCUMENT_ID },
      { kind: 'immunisation' as const, verbatim: 'MMR, 1992-10-05', docId: CARD_DOCUMENT_ID },
    ],
  }

  /**
   * Written out rather than compared against a second run alone, so this pins
   * the keys instead of only proving the pack is deterministic. A renamed key
   * orphans the clinician's approved or dismissed rows.
   */
  const EXPECTED_KEYS = [
    'nhs-record-condition:type2diabetesmellitus',
    'nhs-screen-diabetic-eye:invite',
    'ukhsa-country-hepb:serology',
    'ukhsa-imm-mmr-under-12-months:top-up',
    'ukhsa-imm-primary-course:card',
    'ukhsa-imm-primary-course:plan',
    'ukhsa-new-arrival-orientation:entitlements',
  ]

  const keysOf = (profile: PatientProfile) =>
    applyRules(profile, pack)
      .map((o) => o.outputKey)
      .sort()

  it('produces the same outputKey set both times', () => {
    const profile = profileFrom(spec)
    const first = keysOf(profile)
    const second = keysOf(profile)

    assert.deepEqual(first, EXPECTED_KEYS)
    assert.deepEqual(second, first)
  })

  it('produces the same set from a profile rebuilt from the same claims', () => {
    // The post-call re-run rebuilds the profile rather than reusing one, so
    // stability has to survive the projection being built twice.
    assert.deepEqual(keysOf(profileFrom(spec)), EXPECTED_KEYS)
  })

  it('namespaces every key by the rule that emitted it', () => {
    for (const outcome of applyRules(profileFrom(spec), pack)) {
      assert.ok(
        outcome.outputKey.startsWith(`${outcome.ruleId}:`),
        `${outcome.outputKey} is not namespaced by ${outcome.ruleId}, so two rules could collide`,
      )
    }
  })
})

describe('rule output and the recovery metric', () => {
  /**
   * ADR 11 keeps a model out of the scoring path. Mixing recommendations into
   * the metric would undo that from the other direction: "12 facts recovered and
   * 6 actions generated" as one number is not a recovery rate.
   *
   * There is no scoring function on this branch to point at, so this is as
   * strongly as it can be put: the pack cannot move the facts a score would be
   * computed from, no module in the pack names either side of the metric, and
   * the two shapes share no field. When the scorer lands, assert it directly
   * against pack output and keep these as the backstop.
   */

  it('leaves the facts a score would be computed from untouched', () => {
    // The richest row in the spread, so every list a rule reads is non-empty.
    const index = SPREAD.findIndex((s) => s.record.conditions.length > 0 && s.card.length > 0)
    assert.ok(index >= 0, 'no row in the spread carries both a record and a card')

    const profile = profileFor(SPREAD[index], index)
    const before = structuredClone(profile)

    applyRules(profile, pack)

    assert.deepEqual(
      profile,
      before,
      'the pack mutating the profile would move the numerator under whoever scores it',
    )
  })

  it('names neither side of the recovery metric anywhere in the pack source', () => {
    const dir = new URL('.', import.meta.url)
    const sources = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.fixtures.ts'),
    )
    // The fixtures and this file are excluded because they name the metric in
    // order to assert about it; the shipped pack is what must not reach it.
    assert.ok(sources.length > pack.length, 'the scan found fewer files than the pack has rules')

    const forbidden = ['RecoveryMetric', 'recovered', 'numerator', 'denominator', 'patients.truth']
    for (const name of sources) {
      const source = readFileSync(new URL(name, dir), 'utf8')
      for (const term of forbidden) {
        assert.ok(!source.includes(term), `rules/${name} names ${term}, which belongs to the metric`)
      }
    }
  })

  it('shares no field with RecoveryMetric on either side', () => {
    type PackOutput = keyof EmittedOutcome | keyof NewRecommendation | keyof NewGap
    type Overlap = Extract<PackOutput, keyof RecoveryMetric>
    // tsc rejects this line if a pack outcome ever gains a total or a recovered
    // field, which is the only part of this invariant the compiler can hold.
    const disjoint: [Overlap] extends [never] ? true : false = true
    assert.ok(disjoint)

    const metric: RecoveryMetric = { total: 0, recovered: 0 }
    const emitted = SPREAD.flatMap((spread, index) => applyRules(profileFor(spread, index), pack))
    const fields = new Set(
      emitted.flatMap((o) => [
        ...Object.keys(o),
        ...Object.keys(o.kind === 'recommendation' ? o.rec : o.gap),
      ]),
    )

    for (const side of Object.keys(metric)) {
      assert.ok(!fields.has(side), `a pack outcome carries ${side}, which is a side of the metric`)
    }
  })
})

describe('the priority a rule declares', () => {
  /**
   * Priority is gap-only metadata: ADR 16's adjudicator reads it to sort the
   * gaps a call asks and nothing reads it on a recommendation. So a rule
   * declares one exactly when it can ask the patient something, and the spread
   * is what decides which rules those are. Asserted against what `evaluate`
   * does rather than against a second declaration beside it, because a
   * declaration can disagree with the code. See #32.
   */
  const emitsGap = new Set(
    SPREAD.flatMap((spread, index) => applyRules(profileFor(spread, index), pack))
      .filter((outcome) => outcome.kind === 'gap')
      .map((outcome) => outcome.ruleId),
  )

  it('is declared by every rule that asks a patient something', () => {
    assert.deepEqual(
      pack.filter((rule) => emitsGap.has(rule.id) && rule.priority === undefined).map((r) => r.id),
      [],
      'the adjudicator sorts gaps on priority, so a gap without one cannot be placed in a call',
    )
  })

  it('is declared by no rule that asks nothing', () => {
    assert.deepEqual(
      pack.filter((rule) => rule.priority !== undefined && !emitsGap.has(rule.id)).map((r) => r.id),
      [],
      'nothing reads priority on a recommendation, so /rules would show a number that means nothing',
    )
  })
})
