'use node'

import { v } from 'convex/values'
import { Agent, run as runAgent, setDefaultOpenAIKey } from '@openai/agents'
import { internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { anchor } from './lib/anchor'
import { MODEL as DEFAULT_MODEL } from './lib/model'
import { clip, messageOf, record, spendOf, withRetry } from './lib/agentRun'
import {
  numberedGoals,
  transcriptAnswerAgent,
  transcriptClaimAgent,
  type TranscriptAgent,
} from './lib/agents'
import { formatTurns, parseTurns } from '../src/lib/transcript'

/**
 * Reading the call back into the record: transcript in, claims and answered
 * gaps out. The second half of ADR 22, and the second place a model touches
 * clinical content, under the same rules as the first
 * (docs/adr/0016-extraction-is-the-only-model-stage.md).
 *
 * `"use node"` because @openai/agents does not run in the default Convex
 * runtime, which is why this module exports exactly one action and no query or
 * mutation: a Node-runtime module can export actions only. Every read and
 * write it needs is a function in convex/call.ts, and the sim clock is read by
 * convex/pipeline.ts, so neither the database half nor the sim client lands in
 * this bundle.
 *
 * Two agents, run concurrently. One reads what the patient said about
 * themselves, the other reads whether the questions the call was sent to ask
 * were answered. Split because they fail differently, and because the answer
 * agent needs the numbered goals in its input and the claim agent must not see
 * them: a list of questions is a list of suggestions, and an agent given both
 * produces the claim the question was fishing for.
 *
 * The anchoring is the part worth reading twice. Both agents are handed the
 * WHOLE transcript, the assistant's lines included, because "yes" means nothing
 * without the question above it. But `anchor` runs against the PATIENT'S TURNS
 * ONLY. The dashboard prompt's verification ladder has the assistant read every
 * drug name, strength and frequency back out loud at least twice, and
 * deliberately read one back WRONG to test for acquiescence. A claim quoted
 * from a readback is our own guess laundered into a medical record, so it has
 * to fail structurally rather than by prompting. See ADR 17.
 */

/**
 * Per ADR 6 and ADR 19, named rather than inferred, so a recorded run can say
 * what produced it. Shares `EXTRACTION_MODEL` with convex/extract.ts: reading
 * the transcript is the same kind of work on the same kind of text, and two
 * overrides would let one deployment run the two halves of recovery on
 * different models without saying so.
 */
const MODEL = process.env.EXTRACTION_MODEL ?? DEFAULT_MODEL

/**
 * Below this many characters of patient speech there is nothing to read. A call
 * answered and hung up at "Hello" costs two model calls to learn what the
 * length of the string already says, and the claim on the row is spent either
 * way, so the bail is before the model and after the claim.
 */
const MIN_PATIENT_CHARS = 40

const summary = v.object({
  /** False where another caller held the claim, or there was nothing to read. */
  read: v.boolean(),
  claims: v.number(),
  answered: v.number(),
  unanswered: v.number(),
  skipped: v.number(),
  unmatched: v.number(),
  /** Agents that failed twice. Each one is also an `agentRuns` row with its error. */
  failures: v.number(),
})

interface Summary {
  read: boolean
  claims: number
  answered: number
  unanswered: number
  skipped: number
  unmatched: number
  failures: number
}

const NOTHING: Summary = {
  read: false,
  claims: 0,
  answered: 0,
  unanswered: 0,
  skipped: 0,
  unmatched: 0,
  failures: 0,
}

/* -------------------------------------------------------------------------- */
/* Reading an agent's output.                                                   */
/* -------------------------------------------------------------------------- */

const KINDS = ['medication', 'condition', 'immunisation', 'family-history', 'allergy'] as const
type SpokenKind = (typeof KINDS)[number]

interface ClaimPayload {
  kind: SpokenKind
  verbatim: string
  resolved?: string
  quote: string
  verified: boolean
}

interface AnswerPayload {
  goalNumber: number
  outcome: 'answered' | 'asked-and-not-known'
  answer: string
  quote: string
  verified: boolean
}

interface SexPayload {
  value: 'male' | 'female'
  quote: string
  verified: boolean
}

/**
 * A field the patient did not give comes back `null` rather than missing:
 * strict Structured Outputs rejects an optional that is not also nullable, so
 * the schemas declare every field required and nullable.
 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Both agents return a top-level object with an `items` array. */
function itemsOf(output: unknown): unknown[] {
  const items = (output as { items?: unknown } | null | undefined)?.items
  return Array.isArray(items) ? items : []
}

function readClaim(raw: unknown, patientLines: string): ClaimPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  const kind = KINDS.find((candidate) => candidate === item.kind)
  const verbatim = text(item.verbatim)
  const quote = text(item.quote)
  /** Neither is anchorable when empty, and an empty quote anchors anything. */
  if (!kind || !verbatim || !quote) return null

  const english = text(item.english)
  return {
    kind,
    verbatim,
    /**
     * ADR 18's translation, and never on a medication: `Claim.resolved` there
     * comes from the dm+d lookup in convex/map.ts, which clears the field when
     * the lookup does not resolve. A translation sitting in it would either be
     * overwritten a moment later or, worse, believed.
     */
    ...(kind !== 'medication' && english ? { resolved: english } : {}),
    quote,
    verified: anchor(patientLines, quote, verbatim).verified,
  }
}

function readAnswer(raw: unknown, patientLines: string): AnswerPayload | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  const outcome =
    item.outcome === 'answered' || item.outcome === 'asked-and-not-known' ? item.outcome : undefined
  const quote = text(item.quote)
  if (outcome === undefined || typeof item.goalNumber !== 'number' || !quote) return null

  return {
    goalNumber: item.goalNumber,
    outcome,
    /** Blank is legal here. `answerGaps` reads a blank `answered` as not known. */
    answer: text(item.answer) ?? '',
    quote,
    /**
     * An answer carries one string rather than a fact inside a line, so step
     * one of ADR 17's ladder is satisfied by passing the quote as its own
     * verbatim, and step two does the work: is this one of the patient's lines?
     */
    verified: anchor(patientLines, quote, quote).verified,
  }
}

/** The claim agent's one non-item field. See ADR 20. */
function readSex(output: unknown, patientLines: string): SexPayload | undefined {
  const raw = (output as { sex?: unknown } | null | undefined)?.sex
  if (typeof raw !== 'object' || raw === null) return undefined
  const item = raw as Record<string, unknown>
  const value = item.value === 'male' || item.value === 'female' ? item.value : undefined
  const quote = text(item.quote)
  if (value === undefined || !quote) return undefined
  return { value, quote, verified: anchor(patientLines, quote, quote).verified }
}

/* -------------------------------------------------------------------------- */
/* The two calls.                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One agent over one transcript. Never throws: a failed call contributes
 * nothing and the failure is recorded as an `agentRuns` row carrying its error,
 * so the pair settles either way and the claim agent still writes what it found
 * when the answer agent refuses.
 *
 * There is no `extractionFailures` entry for this, because that array is keyed
 * by `documentId` and a transcript has none. The recorded run and the console
 * line are the record. See ADR 19.
 */
async function runOne(
  ctx: ActionCtx,
  definition: TranscriptAgent,
  patientId: Id<'patients'>,
  callId: Id<'calls'>,
  input: string,
): Promise<unknown | null> {
  const agent = new Agent({
    name: definition.name,
    instructions: definition.prompt,
    outputType: definition.outputType,
    model: MODEL,
  })

  /** What both paths record, so a failed call reads as the same kind of thing. */
  const sent = {
    patientId,
    callId,
    agent: definition.name,
    model: MODEL,
    instructions: clip(definition.prompt),
    input: clip(input),
  }
  const started = Date.now()

  try {
    /** Static instructions at the front, the transcript at the back, per ADR 6. */
    const { result, attempts } = await withRetry(() => runAgent(agent, input))
    await record(ctx, {
      ...sent,
      attempts,
      durationMs: Date.now() - started,
      /** What the model returned, before anchoring touched it. */
      output: clip(JSON.stringify(result.finalOutput ?? null, null, 2)),
      items: itemsOf(result.finalOutput).length,
      ...spendOf(result.rawResponses),
    })
    return result.finalOutput ?? null
  } catch (error) {
    /** Both attempts are spent by the time anything reaches here. */
    await record(ctx, {
      ...sent,
      attempts: 2,
      durationMs: Date.now() - started,
      error: messageOf(error),
    })
    console.error(`[callExtract] ${definition.name} failed on ${callId}: ${messageOf(error)}`)
    return null
  }
}

/* -------------------------------------------------------------------------- */
/* The stage.                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reads one call's transcript and writes what it holds back onto the record.
 *
 * Scheduled by `finish` and by `complete` in convex/call.ts, so a browser call
 * and a phone call both reach it and a duplicate end-of-call report does not.
 * The right to read is claimed in one transaction before anything else
 * happens; every caller after the first gets null and stops.
 */
export const readTranscript = internalAction({
  args: { callId: v.id('calls') },
  returns: summary,
  handler: async (ctx, { callId }): Promise<Summary> => {
    /**
     * Before the claim, deliberately. The claim is once-only, so spending it
     * and then discovering the deployment has no key would make the call
     * permanently unreadable. A missing key is a deployment error and belongs
     * on the surface.
     */
    const key = process.env.OPENAI_API_KEY
    if (!key) throw new Error('Set OPENAI_API_KEY with `npx convex env set`.')
    setDefaultOpenAIKey(key)

    const claim = await ctx.runMutation(internal.call.claimTranscriptRead, { callId })
    /** Somebody else has it, or the row has no transcript yet. */
    if (!claim) return NOTHING

    /**
     * The anchor target. Patient turns only, and rendered back through
     * `formatTurns` so the shape is the one `parseTurns` reads: Vapi writes
     * `AI:` and `User:` line prefixes, which is what the regex in
     * src/lib/transcript.ts matches, and the browser's live copy is built with
     * `formatTurns` for exactly that reason. Nothing the assistant said is in
     * here, so a quote from a readback cannot anchor. The prefixes are left on
     * because they also stop a quote silently spanning two turns.
     */
    const turns = parseTurns(claim.transcript).filter((turn) => turn.speaker === 'patient')
    const patientLines = formatTurns(turns)
    const spoken = turns.map((turn) => turn.text).join(' ')

    if (spoken.length < MIN_PATIENT_CHARS) {
      console.log(
        `[callExtract] ${claim.vapiCallId}: ${spoken.length} characters from the patient, not reading it`,
      )
      return NOTHING
    }

    /**
     * Concurrent, and the answer agent is skipped entirely when the call
     * carried no goals: there is nothing for a `goalNumber` to index into, so
     * every answer it returned would be out of range. The claim agent still
     * runs, because a patient with no open gaps still says things worth having.
     */
    const answerInput = `${claim.transcript}\n\n---\n\nThe numbered questions the assistant was given:\n\n${numberedGoals(claim.goals)}`
    const [claimOutput, answerOutput] = await Promise.all([
      runOne(ctx, transcriptClaimAgent, claim.patientId, callId, claim.transcript),
      claim.goals.length === 0
        ? Promise.resolve(null)
        : runOne(ctx, transcriptAnswerAgent, claim.patientId, callId, answerInput),
    ])

    const failures =
      (claimOutput === null ? 1 : 0) + (claim.goals.length > 0 && answerOutput === null ? 1 : 0)

    const claims = itemsOf(claimOutput)
      .map((item) => readClaim(item, patientLines))
      .filter((item): item is ClaimPayload => item !== null)

    const answers = itemsOf(answerOutput)
      .map((item) => readAnswer(item, patientLines))
      .filter((item): item is AnswerPayload => item !== null)
    /** Malformed past the schema, so they never reach `answerGaps` to be counted. */
    const dropped = itemsOf(answerOutput).length - answers.length

    const sex = readSex(claimOutput, patientLines)
    const written: number = await ctx.runMutation(internal.call.ingestClaims, {
      patientId: claim.patientId,
      vapiCallId: claim.vapiCallId,
      claims,
      ...(sex ? { sex } : {}),
    })

    const outcome = await ctx.runMutation(internal.call.answerGaps, { callId, answers })

    /**
     * A medication the patient named has no transliteration, so the mapping
     * pass keys on its `verbatim`, and it is the deterministic lookup that
     * decides whether it resolves to a UK ingredient. No model runs in that
     * path. See ADR 2 and convex/map.ts.
     */
    const mapping = await ctx.runMutation(internal.map.mapPatient, { patientId: claim.patientId })

    console.log(
      `[callExtract] ${claim.vapiCallId}: ${written} claims, ${outcome.answered} answered, ` +
        `${outcome.unanswered} unanswered, ${outcome.skipped} already decided, ` +
        `${outcome.unmatched + dropped} unmatched, ${mapping.resolved} mapped, ${failures} failures`,
    )

    /**
     * Re-runs the pack against what the call added, at the sim's current date.
     * An answered gap changes what other rules should say, so the whole pack
     * runs rather than part of it, and convex/rules.ts reconciles rather than
     * appends: a decided row keeps its decision, an `unanswered` gap counts as
     * decided, and the stage guard only moves forward, so a patient already in
     * review is not dragged back out. Last, and unguarded, because everything
     * above it is committed and a failure here should be visible rather than
     * swallowed.
     */
    await ctx.runAction(internal.pipeline.applyRulesNow, { patientId: claim.patientId })

    return {
      read: true,
      claims: written,
      answered: outcome.answered,
      unanswered: outcome.unanswered,
      skipped: outcome.skipped,
      unmatched: outcome.unmatched + dropped,
      failures,
    }
  },
})
