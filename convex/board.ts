import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * Live extraction signal for the board, per ADR 16.
 *
 * `patients.stage` is deliberately coarse and does not move during the fan-out:
 * sixteen agents run in parallel and a linear enum cannot express nine of
 * sixteen. The count of rows in `claims` can, it is reactive already, and it
 * costs no schema field and no write contention. Never read a progress field
 * off `patients` here — there is none, on purpose.
 *
 * `failures` travels with the count because a patient with no claims and no
 * failures genuinely held nothing, while a patient with no claims and a failure
 * is a bug, and the two must not read the same on the row.
 */

const failure = v.object({
  documentId: v.id('documents'),
  /** Absent when the document has since been deleted. */
  documentKind: v.optional(v.string()),
  agent: v.string(),
  message: v.string(),
})

/** Batches the claim count and the extraction failures over one page of the board. */
export const extractionForPatients = query({
  args: { patientIds: v.array(v.id('patients')) },
  returns: v.array(
    v.object({
      patientId: v.id('patients'),
      claimCount: v.number(),
      failures: v.array(failure),
    }),
  ),
  handler: async (ctx, { patientIds }) => {
    const results: {
      patientId: Id<'patients'>
      claimCount: number
      failures: {
        documentId: Id<'documents'>
        documentKind?: string
        agent: string
        message: string
      }[]
    }[] = []

    for (const patientId of patientIds) {
      const patient = await ctx.db.get(patientId)
      if (!patient) continue

      const claims = await ctx.db
        .query('claims')
        .withIndex('by_patient', (q) => q.eq('patientId', patientId))
        .take(1000)

      const failures = []
      for (const entry of patient.extractionFailures ?? []) {
        const document = await ctx.db.get(entry.documentId)
        failures.push({ ...entry, documentKind: document?.kind })
      }

      results.push({ patientId, claimCount: claims.length, failures })
    }

    return results
  },
})
