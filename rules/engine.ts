import type { Confidence } from '../src/types'
import type { EmittedOutcome, PatientProfile, ProfileFact, Rule, RulePack, RuleOutcome } from './types'

/**
 * The engine. Pure: no IO, nothing from Convex, no model.
 *
 * A rule reports the facts it read; everything about the evidence of its output
 * is derived here, so a rule cannot choose its own bucket.
 * See docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

/** Weakest last. ADR 14's ordering, and the only place it is written down. */
const BUCKETS: readonly Confidence[] = ['document-evidenced', 'patient-reported', 'uncertain-mapping']

function weakest(facts: readonly ProfileFact[]): Confidence | undefined {
  let worst: Confidence | undefined
  for (const f of facts) {
    if (worst === undefined || BUCKETS.indexOf(f.confidence) > BUCKETS.indexOf(worst)) {
      worst = f.confidence
    }
  }
  return worst
}

function countryApplies(rule: Rule, country: string): boolean {
  if (rule.countries === 'all') return true
  // Casing is not guaranteed: the code is supplied by an operator or a call. ADR 9.
  return rule.countries.some((c) => c.toUpperCase() === country.toUpperCase())
}

function emit(rule: Rule, outcome: RuleOutcome): EmittedOutcome {
  // ADR 14: anything resting on a synthesised document carries the label too.
  const synthesised = outcome.consumed.some((f) => f.synthesised)

  if (outcome.kind === 'gap') {
    return {
      kind: 'gap',
      ruleId: rule.id,
      outputKey: outcome.outputKey,
      gap: {
        question: outcome.question,
        ruleId: rule.id,
        outputKey: outcome.outputKey,
        synthesised,
        priority: rule.priority,
      },
    }
  }

  const confidence = weakest(outcome.consumed) ?? rule.confidenceFloor
  if (confidence === undefined) {
    throw new Error(
      `rule ${rule.id} consumed no fact and declares no confidenceFloor, so its recommendation has no bucket to inherit (ADR 14)`,
    )
  }

  return {
    kind: 'recommendation',
    ruleId: rule.id,
    outputKey: outcome.outputKey,
    rec: {
      kind: rule.kind,
      title: outcome.title,
      rationale: outcome.rationale,
      confidence,
      evidence: outcome.consumed.map((f) => f.source),
      // The primary citation is the rule's. An outcome may add secondary ones
      // but never displace it. See ADR 15.
      citation: rule.citations[0],
      // Omitted rather than undefined, so a rule that adds none produces the
      // same row it always did.
      ...(outcome.extraCitations === undefined ? {} : { extraCitations: outcome.extraCitations }),
      target: rule.target,
      ruleId: rule.id,
      outputKey: outcome.outputKey,
      synthesised,
    },
  }
}

export function applyRules(profile: PatientProfile, pack: RulePack): EmittedOutcome[] {
  const byKey = new Map<string, EmittedOutcome>()

  for (const rule of pack) {
    if (!countryApplies(rule, profile.country)) continue
    for (const outcome of rule.evaluate(profile)) {
      // Deduplicated by outputKey alone, which is what makes a re-run idempotent
      // and the pack order-independent: the key is namespaced by rule id, so a
      // collision is one rule emitting twice, where order is the rule's own.
      if (!byKey.has(outcome.outputKey)) byKey.set(outcome.outputKey, emit(rule, outcome))
    }
  }

  return [...byKey.values()]
}
