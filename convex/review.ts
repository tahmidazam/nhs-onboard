import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import schema from './schema'

/** Queries and mutations for the review screen. Approval schedules the write-back action. */

/**
 * Derived from the schema, so a new recommendation kind cannot break this query
 * and `clinicianNote` arrives without a second copy of the field list.
 * Exported because convex/clinic.ts returns the same rows.
 */
export const recommendationDoc = schema.doc('recommendations')

/**
 * The confirm dialog's action: moves the selected recommendations from
 * `proposed` to `approved`. A recommendation not currently `proposed` is left
 * alone, so a stale selection from a second browser tab cannot revive a row
 * someone already dismissed. Each row this loop actually patches gets a
 * scheduled write-back to the sim; `convex/writeback.ts`'s own guard refuses
 * a synthesised or unconfirmed row rather than this call site filtering them.
 */
export const confirmApproved = mutation({
  args: { recommendationIds: v.array(v.id('recommendations')) },
  returns: v.null(),
  handler: async (ctx, { recommendationIds }) => {
    for (const id of recommendationIds) {
      const recommendation = await ctx.db.get('recommendations', id)
      if (!recommendation || recommendation.status !== 'proposed') continue
      await ctx.db.patch('recommendations', id, { status: 'approved' })
      await ctx.scheduler.runAfter(0, internal.writeback.post, { recommendationId: id })
    }
    return null
  },
})

/**
 * Attaches the clinician's own words to a recommendation before it is written
 * back. The note reaches the sim on `indication` or `clinicalDetails`, so it
 * is the one part of the payload a person authored, and it is why
 * `convex/lib/simAction.ts` labels it there.
 *
 * `proposed` only. A note on an approved row would describe a resource the sim
 * already holds unchanged, which reads as a correction that never landed, and
 * a note on a dismissed row has nowhere to go at all.
 *
 * An empty note removes the field rather than storing '': patch drops a field
 * set to undefined, so clearing and never writing one leave the same row, and
 * nothing downstream has to tell an empty note from no note.
 */
export const setNote = mutation({
  args: { recommendationId: v.id('recommendations'), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { recommendationId, note }) => {
    const recommendation = await ctx.db.get('recommendations', recommendationId)
    if (!recommendation || recommendation.status !== 'proposed') return null
    const trimmed = note.trim()
    await ctx.db.patch('recommendations', recommendationId, {
      clinicianNote: trimmed === '' ? undefined : trimmed,
    })
    return null
  },
})

/** Dismisses one recommendation. Reversible only by an operator with database access. */
export const dismiss = mutation({
  args: { recommendationId: v.id('recommendations') },
  returns: v.null(),
  handler: async (ctx, { recommendationId }) => {
    const recommendation = await ctx.db.get('recommendations', recommendationId)
    if (!recommendation || recommendation.status !== 'proposed') return null
    await ctx.db.patch('recommendations', recommendationId, { status: 'dismissed' })
    return null
  },
})
