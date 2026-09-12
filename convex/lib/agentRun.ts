/**
 * Recording one model call, per docs/adr/0019-model-calls-are-recorded-in-convex.md.
 *
 * Lifted verbatim out of convex/extract.ts so that the two Node actions that
 * call models, extraction over documents and convex/callExtract.ts over a
 * transcript, share one definition of "one retry and no more", one clip limit,
 * and one rule about a failed transcript not being allowed to fail the call it
 * describes. Two copies of a retry policy drift, and the sheet then shows two
 * kinds of row.
 *
 * These are helpers rather than Convex functions, so this file exports no
 * query, mutation or action and is safe to import from either runtime.
 */

import type { ActionCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'

export function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/**
 * Convex caps a document at 1MB and a recorded run holds three strings, the
 * longest of which is a document the degrader wrote or a transcript a call
 * produced. Clipping says so in the text: a transcript that quietly lost its
 * tail is worse than one that admits where it stops.
 */
export const LIMIT = 24_000

export function clip(value: string): string {
  if (value.length <= LIMIT) return value
  return `${value.slice(0, LIMIT)}\n[clipped at ${LIMIT} characters]`
}

/** The fields of one recorded run, as convex/extractDb.ts stores them. */
export interface RunRecord {
  patientId: Id<'patients'>
  /** Set on a run that read a document. Exactly one of this and `callId`. */
  documentId?: Id<'documents'>
  /** Set on a run that read a call transcript. See ADR 22. */
  callId?: Id<'calls'>
  agent: string
  model: string
  attempts: number
  durationMs: number
  instructions: string
  input: string
  output?: string
  items?: number
  responseId?: string
  inputTokens?: number
  outputTokens?: number
  error?: string
}

/**
 * What the run cost, summed across turns. An agent with no tools and no handoff
 * takes exactly one, so the sum is a formality that stays correct if either
 * changes. Absent fields mean the SDK reported none, which is not the same as
 * zero and should not be shown as it.
 */
export function spendOf(
  responses: readonly {
    usage?: { inputTokens?: number; outputTokens?: number }
    responseId?: string
  }[],
): { responseId?: string; inputTokens?: number; outputTokens?: number } {
  if (responses.length === 0) return {}
  const inputTokens = responses.reduce((total, r) => total + (r.usage?.inputTokens ?? 0), 0)
  const outputTokens = responses.reduce((total, r) => total + (r.usage?.outputTokens ?? 0), 0)
  /** The last turn's id: the one the dashboard trace opens on. */
  const responseId = responses[responses.length - 1]?.responseId

  return {
    ...(responseId ? { responseId } : {}),
    ...(inputTokens ? { inputTokens } : {}),
    ...(outputTokens ? { outputTokens } : {}),
  }
}

/**
 * Writes one transcript, and swallows its own failure.
 *
 * Deliberate: recording sits beside the stage rather than inside it, so a write
 * that fails cannot demote a call that returned claims into a call the patient
 * row reports as failed. The console line is the fallback, and the missing row
 * is visible as a gap in a sheet that shows the rest.
 */
export async function record(ctx: ActionCtx, run: RunRecord): Promise<void> {
  try {
    await ctx.runMutation(internal.extractDb.recordRun, run)
  } catch (error) {
    const read = run.documentId ?? run.callId ?? run.patientId
    console.error(`[agentRun] could not record ${run.agent} on ${read}: ${messageOf(error)}`)
  }
}

/**
 * One retry, and no more. A third attempt buys little against a model that has
 * refused twice, and costs the demo the latency it can least afford.
 *
 * The attempt count comes back with the value because the recorded run should
 * be able to say whether the first call held. See ADR 19.
 */
export async function withRetry<T>(attempt: () => Promise<T>): Promise<{ result: T; attempts: number }> {
  try {
    return { result: await attempt(), attempts: 1 }
  } catch {
    return { result: await attempt(), attempts: 2 }
  }
}
