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
  /** Frozen simulation clock. Every age below derives from it. */
  asOf: string
  ageYears: number
  ageMonths: number
  /**
   * Always absent: the sim carries no sex, in neither the patient item nor the
   * FHIR projection. A rule needing it emits a Gap. See CONTEXT.md known gaps.
   */
  sex?: 'male' | 'female'
  /** ISO 3166-1 alpha-2, supplied at onboarding. See ADR 9. */
  country: string
  conditions: ProfileFact[]
  medications: ProfileFact[]
  allergies: ProfileFact[]
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
  /** 1 is highest. The adjudicator fills a call from priority order. */
  priority: 1 | 2 | 3
  /** Prose, rendered on /rules. What this rule reads to decide. */
  reads: string
  evaluate(profile: PatientProfile): RuleOutcome[]
}

export type RulePack = readonly Rule[]

export type NewRecommendation = Omit<Recommendation, 'id' | 'patientId' | 'status' | 'simResourceId'>
export type NewGap = Omit<Gap, 'id' | 'patientId' | 'status' | 'answer'>

/** Assembled by the engine from a RuleOutcome and its rule's metadata. */
export type EmittedOutcome =
  | { kind: 'recommendation'; ruleId: string; outputKey: string; rec: NewRecommendation }
  | { kind: 'gap'; ruleId: string; outputKey: string; gap: NewGap }
