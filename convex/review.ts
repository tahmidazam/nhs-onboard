import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/** Queries and mutations for the review screen. Nothing here posts to the sim. */

const confidence = v.union(
  v.literal('document-evidenced'),
  v.literal('patient-reported'),
  v.literal('uncertain-mapping'),
)

const sourceRef = v.object({
  kind: v.union(v.literal('document'), v.literal('transcript'), v.literal('sim-record')),
  id: v.string(),
  quote: v.string(),
})

const citation = v.object({ url: v.string(), quote: v.string() })

const recommendationDoc = v.object({
  _id: v.id('recommendations'),
  _creationTime: v.number(),
  patientId: v.id('patients'),
  kind: v.union(
    v.literal('prescription'),
    v.literal('referral'),
    v.literal('screening'),
    v.literal('immunisation'),
    v.literal('test'),
    v.literal('task'),
  ),
  title: v.string(),
  rationale: v.string(),
  confidence,
  evidence: v.array(sourceRef),
  citation: v.optional(citation),
  extraCitations: v.optional(v.array(citation)),
  target: v.union(v.literal('pharmacy'), v.literal('referrals'), v.literal('diagnostics'), v.literal('gp')),
  simResourceId: v.optional(v.string()),
  status: v.union(v.literal('proposed'), v.literal('approved'), v.literal('dismissed')),
  ruleId: v.optional(v.string()),
  outputKey: v.optional(v.string()),
  synthesised: v.optional(v.boolean()),
})

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
 * someone already dismissed.
 *
 * WRITE-BACK CALL SITE. Once convex/writeback.ts exists, schedule its action
 * here for each id that this loop actually patches, for example:
 *   await ctx.scheduler.runAfter(0, internal.writeback.post, { recommendationId: id })
 */
export const confirmApproved = mutation({
  args: { recommendationIds: v.array(v.id('recommendations')) },
  returns: v.null(),
  handler: async (ctx, { recommendationIds }) => {
    for (const id of recommendationIds) {
      const recommendation = await ctx.db.get('recommendations', id)
      if (!recommendation || recommendation.status !== 'proposed') continue
      await ctx.db.patch('recommendations', id, { status: 'approved' })
      // WRITE-BACK CALL SITE: schedule convex/writeback.ts's action for `id` here.
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
