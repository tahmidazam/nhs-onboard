import type { Doc } from '../../../convex/_generated/dataModel'
import { GAP_STATUS_COPY, GAP_STATUS_ORDER } from './copy'

/**
 * The questions the call was given, whatever became of them.
 *
 * Every status renders. An answered or unanswered gap used to be invisible
 * here, which threw away the point of making the call: ADR 22 added
 * `unanswered` precisely so the screen could tell asked and not established
 * apart from never asked, and ADR 3's refusal to suppress an unresolved row
 * applies to a question the same way.
 *
 * Open first, then unanswered, then answered, and by call priority inside each.
 * That is the order the adjudicator fills a call from, so it is the order the
 * clinician reads the outstanding work in.
 */

function sortGaps(gaps: readonly Doc<'gaps'>[]): Doc<'gaps'>[] {
  return [...gaps].sort(
    (a, b) =>
      GAP_STATUS_ORDER[a.status] - GAP_STATUS_ORDER[b.status] ||
      (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER),
  )
}

export function GapPanel({ gaps }: { gaps: readonly Doc<'gaps'>[] }) {
  if (gaps.length === 0) return null

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-medium">Questions for the patient</h2>
      <ul className="flex flex-col">
        {sortGaps(gaps).map((gap) => (
          <li key={gap._id} className="flex flex-col gap-1 border-t border-border py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-sm">{gap.question}</span>
              <span className="text-xs text-muted-foreground">{GAP_STATUS_COPY[gap.status]}</span>
            </div>
            {gap.answer && (
              <blockquote className="border-l border-border pl-3 text-sm text-muted-foreground">
                {gap.answer}
              </blockquote>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
