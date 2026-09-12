import { v } from 'convex/values'
import { api, internal } from './_generated/api'
import { action, internalAction, internalMutation } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { isForwardMove } from './lib/pipelineStages'
import { readClock } from './lib/simClient'

/**
 * Drives one patient through the pipeline: degrade, extract, map medications,
 * apply rules, then stops at `ready-for-review`. A TypeScript function, not a
 * model, decides what runs next. See docs/adr/0004-code-orchestrator.md.
 *
 * Degrade and extract are each wrapped in `optionalStage`: while parallel work
 * was landing `convex/degrade.ts` and `convex/extract.ts`, calling either
 * threw a "no such function" error, and that is caught, logged and treated as
 * a skip rather than failing the run. Both files exist now, so this also
 * keeps the pipeline running if either stage is later reverted or broken.
 *
 * Map medications and apply rules are hard dependencies: both already exist
 * and are called unguarded, so a real failure in either surfaces rather than
 * being swallowed. Extraction already calls the mapping pass itself once its
 * agents settle, so this call is normally a fast, idempotent repeat; it is
 * also what maps whatever claims exist when extraction is unavailable.
 */

const stage = v.union(
  v.literal('not-onboarded'),
  v.literal('degrading'),
  v.literal('documents-ready'),
  v.literal('extracting'),
  v.literal('mapping'),
  v.literal('applying-rules'),
  v.literal('awaiting-call'),
  v.literal('ready-for-review'),
  v.literal('actioned'),
)

/** No voice call runs inside this action, so the pipeline's own final stage is `ready-for-review`. */
const FINAL_STAGE = 'ready-for-review' as const

/** Moves `patients.stage` forward only, so a re-run cannot undo a clinician's review. */
export const advanceStage = internalMutation({
  args: { patientId: v.id('patients'), stage },
  returns: v.null(),
  handler: async (ctx, { patientId, stage }) => {
    const patient = await ctx.db.get(patientId)
    if (!patient) throw new Error(`pipeline: no patient ${patientId}`)
    if (isForwardMove(patient.stage, stage)) {
      await ctx.db.patch(patientId, { stage })
    }
    return null
  },
})

/**
 * Runs a stage that may not be deployed, or may fail independently of this
 * run. Any error is logged and swallowed, so the pipeline continues to
 * whatever stage does exist and does succeed.
 */
async function optionalStage(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`[pipeline] ${label} not available, skipping: ${message}`)
  }
}

/** What the rule pack emitted, and what a re-run reconciled away. */
const rulesResult = v.object({
  recommendations: v.number(),
  gaps: v.number(),
  removed: v.number(),
})

interface RulesResult {
  recommendations: number
  gaps: number
  removed: number
}

/**
 * The one place that turns the sim clock into `asOf`.
 *
 * `applyRules` takes the date as an argument and never fetches it, so the step
 * stays deterministic and quotes the same clock the screen shows (ADR 11).
 * Something has to do the fetching, and `readClock` is HTTP, so it has to be an
 * action. This is it, and both callers go through it rather than each reading
 * the clock their own way and disagreeing by a tick.
 */
async function applyRulesAsOfNow(
  ctx: ActionCtx,
  patientId: Id<'patients'>,
): Promise<RulesResult> {
  const clock = await readClock()
  return await ctx.runMutation(internal.rules.applyRules, {
    patientId,
    asOf: new Date(clock.now).toISOString(),
  })
}

/**
 * Re-runs the rule pack against whatever the record now holds, at the sim's
 * current date. Called by convex/callExtract.ts once the call's claims and
 * answers are written, which is the whole reason it is a separate export: that
 * module carries `"use node"` for @openai/agents, and this keeps `readClock`
 * and the sim client out of the Node bundle.
 *
 * Safe to repeat. `planRows` in convex/rules.ts treats a decided row as
 * decided, so an approved recommendation and an answered or unanswered gap are
 * untouched, and the stage guard there only ever moves forward. See ADR 22.
 */
export const applyRulesNow = internalAction({
  args: { patientId: v.id('patients') },
  returns: rulesResult,
  handler: async (ctx: ActionCtx, { patientId }: { patientId: Id<'patients'> }): Promise<RulesResult> =>
    applyRulesAsOfNow(ctx, patientId),
})

export const run = action({
  args: { patientId: v.id('patients') },
  returns: v.null(),
  handler: async (ctx: ActionCtx, { patientId }: { patientId: Id<'patients'> }) => {
    await optionalStage('degrade', () => ctx.runAction(api.degrade.degrade, { patientId }))

    await optionalStage('extract', () => ctx.runAction(api.extract.run, { patientId }))

    await ctx.runMutation(internal.pipeline.advanceStage, { patientId, stage: 'mapping' })
    await ctx.runMutation(internal.map.mapPatient, { patientId })

    await ctx.runMutation(internal.pipeline.advanceStage, { patientId, stage: 'applying-rules' })
    await applyRulesAsOfNow(ctx, patientId)

    await ctx.runMutation(internal.pipeline.advanceStage, { patientId, stage: FINAL_STAGE })
    return null
  },
})
