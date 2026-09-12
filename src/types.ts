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
  status: 'open' | 'answered'
  answer?: string
}

export type RecommendationKind = 'prescription' | 'referral' | 'screening' | 'immunisation' | 'test'

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
  target: SimTarget
  simResourceId?: string
  status: 'proposed' | 'approved' | 'dismissed'
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
