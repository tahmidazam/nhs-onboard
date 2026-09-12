import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { mayWriteBack } from '../src/lib/writeBack'
import { buildSimAction } from './lib/simAction'
import { postAction } from './lib/simClient'

/**
 * Writes one approved Recommendation to the sim as a real resource.
 *
 * `mayWriteBack` is the one gate: it refuses a recommendation resting on a
 * synthesised document whatever its bucket, and refuses anything short of
 * `document-evidenced`, per ADR 3 and ADR 14. This calls it rather than
 * repeating the check.
 *
 * Writes go through `/api/sites/gp/actions` regardless of `target`, since that
 * is the only route visible in the GP view. See
 * `.claude/skills/nhs-sim/SKILL.md`.
 *
 * `post` is the call site `convex/review.ts`'s `confirmApproved` names:
 * `ctx.scheduler.runAfter(0, internal.writeback.post, { recommendationId })`.
 */

const refusal = v.union(
  v.literal('synthesised-evidence'),
  v.literal('unconfirmed-report'),
  v.literal('unresolved-mapping'),
)

const result = v.union(
  v.object({ written: v.literal(true), simResourceId: v.string() }),
  v.object({ written: v.literal(false), refusal }),
)

type Result = { written: true; simResourceId: string } | { written: false; refusal: 'synthesised-evidence' | 'unconfirmed-report' | 'unresolved-mapping' }

const recommendationForWriteback = schema.doc('recommendations').extend({ simPatientId: v.string() })

/** The recommendation plus the sim id of the patient it belongs to. */
export const getForWriteback = internalQuery({
  args: { recommendationId: v.id('recommendations') },
  returns: v.union(v.null(), recommendationForWriteback),
  handler: async (ctx, { recommendationId }) => {
    const rec = await ctx.db.get(recommendationId)
    if (!rec) return null
    const patient = await ctx.db.get(rec.patientId)
    if (!patient) return null
    return { ...rec, simPatientId: patient.simId }
  },
})

export const recordWriteback = internalMutation({
  args: { recommendationId: v.id('recommendations'), simResourceId: v.string() },
  returns: v.null(),
  handler: async (ctx, { recommendationId, simResourceId }) => {
    await ctx.db.patch(recommendationId, { simResourceId, status: 'approved' })
    return null
  },
})

export const post = internalAction({
  args: { recommendationId: v.id('recommendations') },
  returns: result,
  handler: async (ctx, { recommendationId }: { recommendationId: Id<'recommendations'> }): Promise<Result> => {
    const rec = await ctx.runQuery(internal.writeback.getForWriteback, { recommendationId })
    if (!rec) throw new Error(`writeback: no recommendation ${recommendationId}`)

    // Already written: the sim's own Idempotency-Key would return the same
    // resource anyway, but skipping the call avoids spending finite capacity
    // (order_test) on a retry that changes nothing.
    if (rec.simResourceId) return { written: true, simResourceId: rec.simResourceId }

    const decision = mayWriteBack(rec)
    if (!decision.writable) return { written: false, refusal: decision.refusal }

    const payload = buildSimAction(rec, rec.simPatientId)
    const created = await postAction('gp', payload, recommendationId)

    await ctx.runMutation(internal.writeback.recordWriteback, {
      recommendationId,
      simResourceId: created.id,
    })
    return { written: true, simResourceId: created.id }
  },
})
