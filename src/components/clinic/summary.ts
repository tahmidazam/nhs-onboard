import type { FunctionReturnType } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Doc } from '../../../convex/_generated/dataModel'
import { BUCKET_ORDER, KIND_SILO, type SiloId } from '@/lib/buckets'

/**
 * The shape `clinic.summary` returns, derived rather than restated. The query
 * is validated against `schema.doc(...)`, so a column added to `patients` or
 * `gaps` reaches these components without a second declaration to update.
 */
export type ClinicSummary = NonNullable<FunctionReturnType<typeof api.clinic.summary>>

/** One reconstructed line of history, as the Background band shows it. */
export type BackgroundItem = ClinicSummary['background']['problems'][number]

export type Recommendation = Doc<'recommendations'>

/** Undecided first: the work the screen exists for, above what has been settled. */
const STATUS_ORDER: Record<Recommendation['status'], number> = {
  proposed: 0,
  approved: 1,
  dismissed: 2,
}

function bucketRank(row: Recommendation): number {
  const index = BUCKET_ORDER.indexOf(row.confidence)
  return index === -1 ? BUCKET_ORDER.length : index
}

/**
 * Recommendations grouped into the silos ADR 21 sorts by. Undecided rows first
 * inside each silo, then best evidenced first, because that is the order a GP
 * works down a list.
 *
 * `KIND_SILO` maps `task` to null, since no rule has emitted one since problem
 * and allergy replaced it. A leftover row lands in `record` rather than falling
 * out of every silo: `convex/clinic.ts` counts it there too, and a header count
 * that does not match the rows under it is worse than a row in a loose silo.
 */
export function groupBySilo(recommendations: readonly Recommendation[]): Map<SiloId, Recommendation[]> {
  const grouped = new Map<SiloId, Recommendation[]>()
  for (const row of recommendations) {
    const silo = KIND_SILO[row.kind] ?? 'record'
    const list = grouped.get(silo) ?? []
    list.push(row)
    grouped.set(silo, list)
  }
  for (const list of grouped.values()) {
    list.sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || bucketRank(a) - bucketRank(b),
    )
  }
  return grouped
}
