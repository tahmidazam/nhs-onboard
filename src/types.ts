/**
 * Shared contract between both workstreams.
 * Dev A produces PresentedDocument[]. Dev B produces Recommendation[].
 * Tell the other developer before editing.
 */

/** Routes a claim in the review UI and controls whether it can be written back. */
export type Confidence =
  /** Backed by a source document. Can become a draft prescription or referral. */
  | 'document-evidenced'
  /** Asserted by the patient. Becomes a question for the clinician, never a prescription. */
  | 'patient-reported'
  /** Found but not safely resolvable. Shown verbatim, never actioned. */
  | 'uncertain-mapping'

export interface SourceRef {
  kind: 'document' | 'transcript' | 'sim-record'
  /** PresentedDocument.id, Vapi call id, or sim resource id. */
  id: string
  /** Verbatim text the claim rests on. Highlighted in the source view. */
  quote: string
  /** Quote anchored against the document by containment; absent where anchoring does not apply. See ADR 17. */
  verified?: boolean
}

/**
 * Sex with its provenance. The sim has no sex field, so this is read at
 * onboarding from the gendered pronouns in its narrative text, or settled by
 * the call when a patient's narrative has none. A gate and never evidence, so
 * no recommendation consumes it. See ADR 20.
 */
export interface PatientSex {
  value: 'male' | 'female'
  confidence: Confidence
  source: SourceRef
}

/** A patient as the sim holds them. Also the answer key for RecoveryMetric. */
export interface PatientRecord {
  id: string
  name: string
  birthDate: string
  conditions: string[]
  medications: string[]
  allergies: string[]
  immunisations: string[]
  raw: unknown
}

/** A PatientRecord after the degrader drops, translates and unstructures it. */
export interface PresentedDocument {
  id: string
  patientId: string
  kind: 'discharge-summary' | 'vaccination-card' | 'prescription-list' | 'clinic-letter'
  /** BCP-47, e.g. 'bn', 'hi', 'uk'. */
  language: string
  /** ISO 3166-1 alpha-2. Selects the brand dataset in sources.ts. */
  country: string
  text: string
  /** Generated rather than derived from the sim record. Labelled in the UI. */
  synthesised?: boolean
}

export type ClaimKind = 'medication' | 'condition' | 'immunisation' | 'family-history' | 'allergy'

export interface Claim {
  id: string
  patientId: string
  kind: ClaimKind
  /** As written in the source language. Never overwritten. */
  verbatim: string
  /** Resolved UK term, when the lookup succeeds. */
  resolved?: string
  confidence: Confidence
  source: SourceRef
  mapping?: MedicationMapping
}

/** Output of the deterministic brand lookup. No model runs in this path. */
export interface MedicationMapping {
  brand: string
  generic?: string
  /** dm+d VTM. The UK spelling, e.g. 'Paracetamol' where RxNorm says 'acetaminophen'. */
  ukIngredient?: string
  /** dm+d VMP. Written into draft_prescription.drug. */
  prescribable?: string
  vmpId?: string
  ukFormularyName?: string
  /** Cambridge and Peterborough traffic light: 'Green', 'Red Hospital', 'OTC'. */
  rag?: string
  /** Which dataset resolved it. */
  via: 'bd-medex' | 'indian-medicines' | 'idd' | 'rxnav' | 'unresolved'
  unresolved: boolean
}

export interface Gap {
  id: string
  patientId: string
  /** Also used as the voice agent's goal for the call. */
  question: string
  ruleId: string
  /**
   * `unanswered` means asked on the call and not established, which is worth
   * telling apart from never asked. It also counts as decided in the rule
   * pack's reconciliation, so a re-run neither reopens it nor queues it for the
   * next call. See ADR 22.
   */
  status: 'open' | 'answered' | 'unanswered'
  answer?: string
  /**
   * The patient's own words that closed the question, verbatim from the
   * transcript, so an `answered` gap is reviewable rather than asserted.
   * See ADR 22.
   */
  answerQuote?: string
  /** Which call closed it, so review can open that transcript. */
  answeredByCallId?: string
  /** `${ruleId}:${discriminator}`. Makes a post-call re-run idempotent. */
  outputKey?: string
  /** True when the evidence chain touches a synthesised document. See ADR 14. */
  synthesised?: boolean
  /** 1 is highest. The adjudicator fills a call from priority order. */
  priority?: number
}

/** 'task' is the sim's create_task: an action at a site that books no slot. */
export type RecommendationKind =
  | 'prescription'
  | 'referral'
  | 'screening'
  | 'immunisation'
  | 'test'
  | 'task'
  /** Reconstructed history, written onto the GP record rather than actioned. */
  | 'problem'
  | 'allergy'

/** Sim site that owns the resource once written back. */
export type SimTarget = 'pharmacy' | 'referrals' | 'diagnostics' | 'gp'

export interface Recommendation {
  id: string
  patientId: string
  kind: RecommendationKind
  title: string
  /** Shown to the clinician and written to the sim's `indication` field. */
  rationale: string
  confidence: Confidence
  evidence: SourceRef[]
  citation?: { url: string; quote: string }
  /**
   * Behind the primary, never displacing it: the matched country guide row
   * travels here. See ADR 15.
   */
  extraCitations?: Array<{ url: string; quote: string }>
  target: SimTarget
  simResourceId?: string
  status: 'proposed' | 'approved' | 'dismissed'
  /**
   * Free text the clinician added before approving. Survives a rule re-run
   * because the engine never writes this field and `patch` merges. Travels to
   * the sim on `indication`/`clinicalDetails`.
   */
  clinicianNote?: string
  /** The rule that produced this. See ADR 13. */
  ruleId?: string
  /** `${ruleId}:${discriminator}`. Makes a post-call re-run idempotent. */
  outputKey?: string
  /** True when the evidence chain touches a synthesised document. See ADR 14. */
  synthesised?: boolean
}

export type PipelineStage =
  | 'not-onboarded'
  | 'degrading'
  | 'documents-ready'
  | 'extracting'
  | 'mapping'
  | 'applying-rules'
  | 'awaiting-call'
  | 'ready-for-review'
  | 'actioned'

/** Ground-truth facts recovered from the degraded documents. */
export interface RecoveryMetric {
  total: number
  recovered: number
}
