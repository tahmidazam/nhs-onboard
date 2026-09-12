/**
 * Chooses which Gaps go on the voice call. Sort and slice, nothing more:
 * the rule pack (#11) fixed the selection rule completely, leaving nothing
 * for a model to decide. See docs/adr/0016-extraction-is-the-only-model-stage.md.
 *
 * Every Gap not selected stays `open` and visible on the review screen,
 * per docs/adr/0003-three-confidence-buckets.md's unresolved column applied
 * to questions: a clinician can compensate for a visible unanswered question
 * and cannot compensate for one that silently vanished. So this module never
 * deletes, hides or drops a Gap, and never touches `question` text — a
 * question a model phrased is no longer traceable to a cited rule.
 */

/**
 * Structural subset of a Gap plus the `priority` the rule pack attaches to
 * it. Declared locally rather than imported from `rules/` or `src/types.ts`,
 * because the rule pack branch (#12-#20) that defines `Rule` and the Gap
 * schema's `priority` field has not merged here yet. Mirrors the shape it
 * will supply, per issue #11: `priority: 1 | 2 | 3`, where 1 fills a call
 * first.
 */
export interface GapInput {
  id: string
  ruleId: string
  priority: 1 | 2 | 3
  question: string
}

/**
 * Selects the Gaps for a call. Highest priority first; ties break on pack
 * order so the result is stable across runs.
 *
 * A Gap whose `ruleId` is absent from `packOrder` sorts after every Gap
 * whose rule is in the pack, within its priority tier. That should not
 * happen against a real pack — every Gap comes from a rule that is in it —
 * but a caller passing a stale or partial pack order should not have such a
 * Gap jump the queue, which is what `Array.indexOf`'s `-1` would otherwise
 * do by accident.
 */
export function selectGaps<T extends GapInput>(
  gaps: readonly T[],
  packOrder: readonly string[],
  cap = 5,
): { selected: T[]; deferred: T[] } {
  const rank = (ruleId: string) => {
    const i = packOrder.indexOf(ruleId)
    return i === -1 ? packOrder.length : i
  }

  const ordered = [...gaps].sort((a, b) => a.priority - b.priority || rank(a.ruleId) - rank(b.ruleId))

  return { selected: ordered.slice(0, cap), deferred: ordered.slice(cap) }
}
