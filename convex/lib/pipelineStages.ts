import type { PipelineStage } from '../../src/types'

/**
 * Where each stage sits in the pipeline. A re-run's stage writes are checked
 * against this order, so repeating a stage can never drag a patient backwards
 * past a clinician's review. See docs/adr/0004-code-orchestrator.md.
 */
export const STAGE_ORDER: Record<PipelineStage, number> = {
  'not-onboarded': 0,
  degrading: 1,
  'documents-ready': 2,
  extracting: 3,
  mapping: 4,
  'applying-rules': 5,
  'awaiting-call': 6,
  'ready-for-review': 7,
  actioned: 8,
}

/** True when `target` sits strictly ahead of `current` in the pipeline. */
export function isForwardMove(current: PipelineStage, target: PipelineStage): boolean {
  return STAGE_ORDER[current] < STAGE_ORDER[target]
}
