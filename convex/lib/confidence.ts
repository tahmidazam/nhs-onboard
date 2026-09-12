import type { Confidence, SourceRef } from '../../src/types'

/**
 * The confidence bucket, per ADR 3's table as fixed by ADR 17.
 *
 * Code assigns it, from the three things code already knows. No extraction
 * schema carries a `confidence` field, because a model would fill it plausibly
 * and occasionally wrong in the direction that flatters us (ADR 16).
 *
 * | source kind  | anchored | mapping            | bucket              |
 * |--------------|----------|--------------------|---------------------|
 * | `document`   | yes      | resolved or n/a    | `document-evidenced`|
 * | `document`   | yes      | `unresolved: true` | `uncertain-mapping` |
 * | `document`   | no       | any                | `uncertain-mapping` |
 * | `transcript` | n/a      | any                | `patient-reported`  |
 * | `sim-record` | n/a      | any                | `document-evidenced`|
 */
export function bucketFor(input: {
  sourceKind: SourceRef['kind']
  verified?: boolean
  mappingUnresolved?: boolean
}): Confidence {
  /** A patient's own assertion becomes a question, never a prescription. */
  if (input.sourceKind === 'transcript') return 'patient-reported'

  /** Nothing to anchor: the sim is the source of truth, per ADR 1. */
  if (input.sourceKind === 'sim-record') return 'document-evidenced'

  /** Demoted and kept, never dropped, so the failure stays countable (ADR 3). */
  if (input.verified !== true) return 'uncertain-mapping'

  return input.mappingUnresolved === true ? 'uncertain-mapping' : 'document-evidenced'
}
