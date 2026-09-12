/**
 * THE CONTRACT.
 *
 * Both workstreams build against this file. Dev A produces PresentedDocument[];
 * Dev B consumes them and produces Recommendation[].
 *
 * Do not edit without telling the other developer out loud. Adding a field is
 * cheap; renaming one costs both of you a rebase you do not have time for.
 */

/** How much we trust a claim. Drives routing in the review UI and write-back. */
export type Confidence =
  /** Backed by a source document. Becomes a draft prescription / referral. */
  | 'document-evidenced'
  /** Asserted by the patient on a call or in chat. Becomes a question to confirm. */
  | 'patient-reported'
  /** We found something but could not resolve it safely. Shown verbatim, never actioned. */
  | 'uncertain-mapping'

/** Where a claim came from. Every claim has one; this is what "evidenced" means. */
export interface SourceRef {
  kind: 'document' | 'transcript' | 'sim-record'
  /** PresentedDocument.id, or the Vapi call id, or the sim resource id. */
  id: string
  /** Verbatim text that motivated the claim. Rendered in the UI, highlighted in the source. */
  quote: string
}

// ---------------------------------------------------------------------------
// Dev A's output
// ---------------------------------------------------------------------------

/** A patient as the sim holds them. Ground truth — also our evaluation answer key. */
export interface PatientRecord {
  id: string
  name: string
  birthDate: string
  conditions: string[]
  medications: string[]
  allergies: string[]
  immunisations: string[]
  /** Everything else the sim returned, kept raw so nothing is lost. */
  raw: unknown
}

/**
 * A record as the patient actually presents it: partial, foreign-language,
 * unstructured. Produced by the degrader from a PatientRecord.
 */
export interface PresentedDocument {
  id: string
  patientId: string
  kind: 'discharge-summary' | 'vaccination-card' | 'prescription-list' | 'clinic-letter'
  /** BCP-47, e.g. 'bn', 'hi', 'uk'. */
  language: string
  /** ISO 3166-1 alpha-2 — selects the brand dataset in the source registry. */
  country: string
  /** The document as the patient hands it over. Rendered with Typeset. */
  text: string
}

// ---------------------------------------------------------------------------
// Dev B's output
// ---------------------------------------------------------------------------

export type ClaimKind = 'medication' | 'condition' | 'immunisation' | 'family-history' | 'allergy'

/** One extracted fact. Always carries where it came from. */
export interface Claim {
  id: string
  patientId: string
  kind: ClaimKind
  /** As written in the source, in the source language. Never overwritten. */
  verbatim: string
  /** Resolved English/UK term, if we got there. */
  resolved?: string
  confidence: Confidence
  source: SourceRef
  /** Only on medication claims. */
  mapping?: MedicationMapping
}

/** Result of the deterministic foreign-brand → UK lookup. No model involved. */
export interface MedicationMapping {
  /** e.g. 'Napa' */
  brand: string
  /** e.g. 'Paracetamol' */
  generic?: string
  /** Matched entry in the Cambridge & Peterborough formulary. */
  ukFormularyName?: string
  /** Formulary traffic-light: 'Green' | 'Amber SCG' | 'Red Hospital' | 'Black' | 'OTC' | ... */
  rag?: string
  /** Which dataset resolved it — shown in the UI so the chain is auditable. */
  via: 'bd-medex' | 'indian-medicines' | 'idd' | 'rxnav' | 'unresolved'
  /** True when the lookup returned nothing. Routes to 'uncertain-mapping'. */
  unresolved: boolean
}

/** Something the record cannot tell us, that a call or chat could resolve. */
export interface Gap {
  id: string
  patientId: string
  /** Human-readable, and doubles as the voice agent's goal. */
  question: string
  /** Rule that raised it, for the evidence chain. */
  ruleId: string
  status: 'open' | 'answered'
  answer?: string
}

export type RecommendationKind = 'prescription' | 'referral' | 'screening' | 'immunisation' | 'test'

/** Where this lands in the sim when a clinician approves it. */
export type SimTarget = 'pharmacy' | 'referrals' | 'diagnostics' | 'gp'

export interface Recommendation {
  id: string
  patientId: string
  kind: RecommendationKind
  title: string
  /** Shown to the clinician, and written into the sim's `indication` field. */
  rationale: string
  confidence: Confidence
  /** Every claim and rule that motivated this. The evidence chain. */
  evidence: SourceRef[]
  /** Guideline citation — URL plus the quoted line it rests on. */
  citation?: { url: string; quote: string }
  target: SimTarget
  /** Populated once written back; the sim resource id. */
  simResourceId?: string
  status: 'proposed' | 'approved' | 'dismissed'
}

// ---------------------------------------------------------------------------
// Pipeline status — drives the board
// ---------------------------------------------------------------------------

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

/** How much of the ground-truth record the pipeline recovered. Shown on the board. */
export interface RecoveryMetric {
  /** Facts in the original sim record. */
  total: number
  /** Facts the pipeline recovered from the degraded documents. */
  recovered: number
}
