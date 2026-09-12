import type { Confidence, Recommendation } from '../types'

/**
 * The write-back boundary: whether one Recommendation may be written to the sim.
 *
 * NOT YET WIRED. Nothing writes to the sim yet, so #33 builds the gate and the
 * review slice that performs the write must call it. Spec #11 leaves that write
 * out of scope and it has no issue of its own; whoever files it, a write-back
 * path that does not route through `mayWriteBack` reopens #33.
 *
 * The bucket cannot carry this on its own. ADR 3 defines `document-evidenced` as
 * the bucket that can become a draft prescription or referral, and ADR 14 leaves
 * a recommendation resting on ADR 8's generated vaccination card in exactly that
 * bucket, labelled rather than demoted, because a card claim genuinely is a
 * document claim. So the label has to stop the write, and this is where it does.
 *
 * See docs/adr/0003-three-confidence-buckets.md,
 * docs/adr/0008-synthesised-immunisations-for-demo.md and
 * docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

/**
 * Grounds for refusal, closed so a new one cannot appear without the review
 * screen being made to say it. Each names what the clinician has to do about it,
 * which a bare "not evidenced" does not: ADR 3 sends a patient-reported row for
 * confirmation and never actions an uncertain-mapping one at all.
 */
export type WriteBackRefusal = 'synthesised-evidence' | 'unconfirmed-report' | 'unresolved-mapping'

/**
 * Discriminated rather than a boolean, because the review screen shows a refused
 * row and says why instead of hiding it. ADR 3 suppresses nothing.
 */
export type WriteBackDecision = { writable: true } | { writable: false; refusal: WriteBackRefusal }

/**
 * A Record rather than a switch, so a fourth bucket added to the shared contract
 * fails to compile here until someone decides whether it writes back.
 */
const REFUSAL_BY_BUCKET: Record<Confidence, WriteBackRefusal | null> = {
  'document-evidenced': null,
  'patient-reported': 'unconfirmed-report',
  'uncertain-mapping': 'unresolved-mapping',
}

/**
 * Pure, and reads only the two fields it judges, so the stored row, the engine's
 * output and a test fixture all satisfy it without an adapter.
 */
export function mayWriteBack(rec: Pick<Recommendation, 'confidence' | 'synthesised'>): WriteBackDecision {
  // Synthesised first, and whatever the bucket: a clinician told only that the
  // row needs confirming would go and confirm a fact the demo invented.
  if (rec.synthesised) return { writable: false, refusal: 'synthesised-evidence' }

  const refusal = REFUSAL_BY_BUCKET[rec.confidence]
  return refusal ? { writable: false, refusal } : { writable: true }
}
