import { v } from 'convex/values'
import { internal } from './_generated/api'
import { mutation, query } from './_generated/server'
import schema from './schema'

/** Queries and mutations for the review screen. Approval schedules the write-back action. */

/** Derived from the schema, so a new recommendation kind cannot break this query. */
const recommendationDoc = schema.doc('recommendations')

/** Patient header plus every recommendation the rule pack produced, for the review screen. */
export const forPatient = query({
  args: { patientId: v.id('patients') },
  returns: v.object({
    patient: v.union(v.null(), v.object({ _id: v.id('patients'), name: v.string() })),
    recommendations: v.array(recommendationDoc),
  }),
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get('patients', patientId)

    const recommendations = await ctx.db
      .query('recommendations')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(500)

    return {
      patient: patient ? { _id: patient._id, name: patient.name } : null,
      recommendations,
    }
  },
})

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
