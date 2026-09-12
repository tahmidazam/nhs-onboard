import type { Confidence, Gap, Recommendation, SourceRef } from '../src/types'

/**
 * The rule pack. Hand-encoded guidance, each rule carrying the line it rests on.
 *
 * See docs/adr/0013-rules-are-typed-typescript-modules.md,
 * docs/adr/0014-rule-output-inherits-the-weakest-evidence.md and
 * docs/adr/0015-country-guides-gate-and-cite.md.
 */

export interface Citation {
  url: string
  /**
   * Verbatim from the source. Never paraphrased and never written from memory:
   * an unverifiable quote is worse than no citation, because it is the one thing
   * here a judge can falsify from their phone.
   */
  quote: string
}

/** One normalised fact a rule read. Its confidence and source travel with it. */
export interface ProfileFact {
  /** Normalised by the recovery matcher, not by a second copy of it. See ADR 11. */
  key: string
  /** As the source wrote it. Never overwritten. */
  verbatim: string
  /** Resolved UK term. For a medication this is the dm+d ukIngredient. */
  resolved?: string
  confidence: Confidence
  source: SourceRef
  /** True when the fact came from a document we generated. See ADR 8. */
  synthesised: boolean
}

export interface ImmunisationFact extends ProfileFact {
  date?: string
  /**
   * Age at the dose, in months. Undefined when the record is too vague to say,
   * which a degraded vaccination card reading "as a child" is. A rule has to be
   * able to tell a record that says no from a record that does not say.
   */
  ageAtDoseMonths?: number
  doseNumber?: number
  /** Drives the discounted-OPV and PCV10 rules. */
  givenAbroad?: boolean
}

/** What a rule reads. Rules never read Claims directly. */
export interface PatientProfile {
  patientId: string
  /**
   * From the sim record, verbatim. Required, because it is the quote an
   * age-driven rule rests on: `ageYears` is arithmetic we did, and a sentence
   * about it is not a quote from the record. See ADR 14 and ageFact in
   * rules/profile.ts.
   */
  birthDate: string
  /** Frozen simulation clock. Every age below derives from it. */
  asOf: string
  ageYears: number
  ageMonths: number
  /**
   * Populated from `patients.sex`, which ADR 20 reads out of the gendered
   * pronouns in the sim's narrative text at onboarding. Still optional: a
   * patient whose narrative carries no pronoun, or both, has none until a call
   * settles it, and `nhs-establish-sex` emits a Gap for exactly that case.
   *
   * A rule may read this to decide, but must never put it in `consumed`: it is
   * a gate, not evidence, the way `country` is. See ADR 20 and CONTEXT.md.
   */
  sex?: 'male' | 'female'
  /** ISO 3166-1 alpha-2, supplied at onboarding. See ADR 9. */
  country: string
  conditions: ProfileFact[]
  medications: ProfileFact[]
  allergies: ProfileFact[]
  /** Read by `nhs-general-history` to tell a thin record from a full one. */
  familyHistory: ProfileFact[]
  immunisations: ImmunisationFact[]
}

/**
 * What a rule emits. `consumed` is how ADR 14 is enforced structurally: a rule
 * reports the facts it read and the engine derives the bucket, the evidence
 * chain and the synthesised flag from them. A rule cannot choose its own bucket.
 */
export type RuleOutcome =
  | {
      kind: 'recommendation'
      /** `${ruleId}:${discriminator}`, stable across runs. */
      outputKey: string
      title: string
      /** Shown to the clinician and written to the sim's indication field. */
      rationale: string
      consumed: ProfileFact[]
      /** Secondary citations, e.g. the patient's own country guide row. See ADR 15. */
      extraCitations?: Citation[]
    }
  | {
      kind: 'gap'
      outputKey: string
      /** Authored here, in English. The adjudicator never rewrites it. */
      question: string
      consumed: ProfileFact[]
    }

export interface Rule {
  /** Semantic, kebab-case, namespaced by source. Renaming one orphans Gap rows. */
  id: string
  kind: Recommendation['kind']
  target: Recommendation['target']
  /** Non-empty by type, so a rule without a citation does not compile. */
  citations: [Citation, ...Citation[]]
  /** The bucket to use when the rule consumed no fact. See ADR 14. */
  confidenceFloor?: Confidence
  /** 'all', or codes generated from countryGuides at build time. See ADR 15. */
  countries: 'all' | string[]
  /**
   * 1 is highest. The adjudicator fills a call from priority order, so this is
   * gap-only metadata: absent on a rule whose `evaluate` asks the patient
   * nothing, because nothing reads a priority on a recommendation. Every gap
   * the adjudicator can receive carries one, since a rule declaring none emits
   * none. Held by rules/coverage.test.ts against what `evaluate` does. See #32.
   */
  priority?: 1 | 2 | 3
  /** Prose, rendered on /rules. What this rule reads to decide. */
  reads: string
  evaluate(profile: PatientProfile): RuleOutcome[]
}

export type RulePack = readonly Rule[]

export type NewRecommendation = Omit<Recommendation, 'id' | 'patientId' | 'status' | 'simResourceId'>
/**
 * A rule asks the question. It never carries the answer, the quote behind it,
 * or the call that produced either: those are written by `convex/call.ts` after
 * the call, and a re-run of the pack must not offer to overwrite them. Omitting
 * them here is what makes the reconciliation in `convex/rules.ts` safe to patch
 * a still-emitted row with. See ADR 22.
 */
export type NewGap = Omit<
  Gap,
  'id' | 'patientId' | 'status' | 'answer' | 'answerQuote' | 'answeredByCallId'
>

/** Assembled by the engine from a RuleOutcome and its rule's metadata. */
export type EmittedOutcome =
  | { kind: 'recommendation'; ruleId: string; outputKey: string; rec: NewRecommendation }
  | { kind: 'gap'; ruleId: string; outputKey: string; gap: NewGap }
