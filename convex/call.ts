import { v } from 'convex/values'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { selectGaps, type GapInput } from './lib/adjudicate'
import { numberedGoals } from './lib/agents'
import { bucketFor } from './lib/confidence'
import { isForwardMove } from './lib/pipelineStages'
import { pack } from '../rules'
import type { PipelineStage } from '../src/types'

/**
 * Places the outbound call, stores the transcript Vapi sends back, and writes
 * what the call established back onto the record. See ADR 22.
 *
 * The assistant lives in the Vapi dashboard so its script can be retuned
 * without a deploy. This file passes the patient's selected gaps in as
 * variables and never sends prompt text.
 *
 * Reading the transcript is a model call and therefore lives in
 * convex/callExtract.ts, which carries `"use node"`. Everything here is a
 * transaction: the plan the call was given, the once-only guard on reading it
 * back, and the two writes that close the loop.
 */

const VAPI_ORIGIN = 'https://api.vapi.ai'

/**
 * The end-of-call report is the fast path and the poll is the safety net, so
 * the first check waits out a short call rather than racing the webhook.
 * The call plan runs about ten minutes, so give up well past that.
 */
const FIRST_POLL_MS = 60_000
const POLL_EVERY_MS = 30_000
const MAX_POLLS = 40

const callStatus = v.union(
  v.literal('pending'),
  v.literal('in-progress'),
  v.literal('complete'),
  v.literal('failed'),
)

const claimKind = v.union(
  v.literal('medication'),
  v.literal('condition'),
  v.literal('immunisation'),
  v.literal('family-history'),
  v.literal('allergy'),
)

/* -------------------------------------------------------------------------- */
/* The call plan.                                                               */
/* -------------------------------------------------------------------------- */

/** One selected gap, as both the call and the call sheet need it. */
const plannedGap = v.object({
  gapId: v.id('gaps'),
  question: v.string(),
  ruleId: v.string(),
  priority: v.union(v.literal(1), v.literal(2), v.literal(3)),
})

interface PlannedGap {
  gapId: Id<'gaps'>
  question: string
  ruleId: string
  priority: 1 | 2 | 3
}

interface CallPlan {
  patientName: string
  patientAge: number
  patientDob: string
  selected: PlannedGap[]
  deferred: PlannedGap[]
}

/** Whole number of years at the sim's current date. */
function ageFrom(birthDate: string, now: number): number {
  const born = new Date(birthDate)
  const today = new Date(now)
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const month = today.getUTCMonth() - born.getUTCMonth()
  if (month < 0 || (month === 0 && today.getUTCDate() < born.getUTCDate())) age--
  return age
}

/** The gap rows, as `selectGaps` wants them, carrying the id back out. */
interface PlanCandidate extends GapInput {
  gapId: Id<'gaps'>
}

/**
 * Everything the call is about, decided once.
 *
 * A plain function rather than two queries, because the questions the assistant
 * is told to ask and the ids an answer resolves against have to come from one
 * read. They used to come from two: `place` took `gapIds` from an internal
 * query and the numbered `goals` string from `callContext`, each running its own
 * `collect`, and nothing tied item i of one to item i of the other. Any
 * index-based attribution on top of that is silently wrong, which is worse than
 * absent, and a call sheet showing a different list to the one the assistant
 * received is the same bug wearing a different hat.
 *
 * A query cannot call another query, so both `callPlan` and the public
 * `callContext` call this directly.
 */
async function planFor(ctx: QueryCtx, patientId: Id<'patients'>): Promise<CallPlan | null> {
  const patient = await ctx.db.get(patientId)
  if (!patient) return null

  /** Bounded by one patient's own gaps, which is a handful. */
  const rows = await ctx.db
    .query('gaps')
    .withIndex('by_patient', (q) => q.eq('patientId', patientId))
    .collect()

  const candidates: PlanCandidate[] = rows
    .filter((gap) => gap.status === 'open')
    .map((gap) => ({
      id: gap._id,
      gapId: gap._id,
      ruleId: gap.ruleId,
      question: gap.question,
      /**
       * `gaps.priority` is optional in the schema and convex/dev.ts seeds rows
       * without one, so a missing priority is coerced to 3 rather than dropping
       * the gap: convex/lib/adjudicate.ts never drops one, and a gap with no
       * priority is a gap worth asking about last, not never.
       */
      priority: gap.priority === 1 || gap.priority === 2 || gap.priority === 3 ? gap.priority : 3,
    }))

  /**
   * The adjudicator, per ADR 16: sort by priority, tie-break on pack order,
   * take five. Code and not a model. Pack order comes from the pack itself, so
   * a rule added to `rules/index.ts` takes its place here with no edit.
   */
  const { selected, deferred } = selectGaps(
    candidates,
    pack.map((rule) => rule.id),
  )

  const strip = (gaps: PlanCandidate[]): PlannedGap[] =>
    gaps.map(({ gapId, question, ruleId, priority }) => ({ gapId, question, ruleId, priority }))

  return {
    patientName: patient.name,
    patientAge: ageFrom(patient.birthDate, Date.now()),
    patientDob: patient.birthDate,
    selected: strip(selected),
    deferred: strip(deferred),
  }
}

/** The plan, for the two writers that place a call. */
export const callPlan = internalQuery({
  args: { patientId: v.id('patients') },
  returns: v.union(
    v.null(),
    v.object({
      patientName: v.string(),
      patientAge: v.number(),
      patientDob: v.string(),
      selected: v.array(plannedGap),
      deferred: v.array(plannedGap),
    }),
  ),
  handler: async (ctx, { patientId }): Promise<CallPlan | null> => planFor(ctx, patientId),
})

/**
 * Everything the assistant's prompt reads as variables. One source, so the
 * phone and browser paths cannot drift apart, and the same source the call
 * itself uses, so the sheet shows the questions the call will actually ask
 * rather than every open gap.
 */
export const callContext = query({
  args: { patientId: v.id('patients') },
  returns: v.union(
    v.null(),
    v.object({
      patientName: v.string(),
      patientAge: v.number(),
      patientDob: v.string(),
      goals: v.array(v.string()),
      /** Over the cap of five. Still open, still on the review screen (ADR 3). */
      deferred: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { patientId }) => {
    const plan = await planFor(ctx, patientId)
    if (!plan) return null
    return {
      patientName: plan.patientName,
      patientAge: plan.patientAge,
      patientDob: plan.patientDob,
      goals: plan.selected.map((gap) => gap.question),
      deferred: plan.deferred.map((gap) => gap.question),
    }
  },
})

export const latestCall = query({
  args: { patientId: v.id('patients') },
  returns: v.union(
    v.null(),
    v.object({
      channel: v.union(v.literal('voice'), v.literal('chat')),
      status: callStatus,
      transcript: v.optional(v.string()),
      transcriptSource: v.optional(v.union(v.literal('live'), v.literal('report'))),
      /** Lets the UI say "ended, transcript on its way" instead of "still running". */
      ended: v.boolean(),
    }),
  ),
  handler: async (ctx, { patientId }) => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .order('desc')
      .first()
    if (!call) return null
    return {
      channel: call.channel,
      status: call.status,
      transcript: call.transcript,
      transcriptSource: call.transcriptSource,
      ended: call.endedAt !== undefined,
    }
  },
})

/* -------------------------------------------------------------------------- */
/* Opening a row.                                                               */
/* -------------------------------------------------------------------------- */

export const create = internalMutation({
  args: {
    patientId: v.id('patients'),
    vapiCallId: v.optional(v.string()),
    language: v.optional(v.string()),
    gapIds: v.array(v.id('gaps')),
    goals: v.array(v.string()),
    status: callStatus,
  },
  returns: v.id('calls'),
  handler: async (ctx, args): Promise<Id<'calls'>> => {
    /**
     * The whole of answer attribution rests on this: index i of `goals` is the
     * question the assistant was given for `gapIds[i]`. Both come off one plan,
     * so a mismatch is a code bug rather than bad data, and it fails here
     * rather than silently writing one gap's answer onto another.
     */
    if (args.gapIds.length !== args.goals.length) {
      throw new Error(
        `call.create: ${args.gapIds.length} gaps against ${args.goals.length} goals. ` +
          'They are the same list read twice and must be the same length.',
      )
    }
    return await ctx.db.insert('calls', { ...args, channel: 'voice' as const })
  },
})

/**
 * Registers a call the browser placed, so the end-of-call report has a row to
 * write into. The phone path inserts its own row in `place`.
 *
 * Freezes the plan here too. The browser builds its `variableValues` from
 * `callContext`, which runs the same selection, so the row records the
 * questions the assistant was actually given and an answer has ids to land on.
 * Without this the browser path, which is what a demo runs on, closes no gap at
 * all.
 */
export const register = mutation({
  args: {
    patientId: v.id('patients'),
    vapiCallId: v.string(),
    language: v.optional(v.string()),
  },
  returns: v.id('calls'),
  handler: async (ctx, { patientId, vapiCallId, language }): Promise<Id<'calls'>> => {
    const plan = await planFor(ctx, patientId)
    if (!plan) throw new Error('That patient does not exist.')

    const callId = await ctx.db.insert('calls', {
      patientId,
      vapiCallId,
      language,
      channel: 'voice',
      status: 'in-progress',
      gapIds: plan.selected.map((gap) => gap.gapId),
      goals: plan.selected.map((gap) => gap.question),
    })
    /** If the tab dies before `finish` runs, the poll still closes the row out. */
    await ctx.scheduler.runAfter(FIRST_POLL_MS, internal.call.poll, {
      callId,
      vapiCallId,
      attempt: 0,
    })
    return callId
  },
})

export const markFailed = internalMutation({
  args: { callId: v.id('calls') },
  returns: v.null(),
  handler: async (ctx, { callId }): Promise<null> => {
    await ctx.db.patch(callId, { status: 'failed', endedAt: Date.now() })
    return null
  },
})

export const attachVapiId = internalMutation({
  args: { callId: v.id('calls'), vapiCallId: v.string() },
  returns: v.null(),
  handler: async (ctx, { callId, vapiCallId }): Promise<null> => {
    await ctx.db.patch(callId, { vapiCallId, status: 'in-progress' })
    return null
  },
})

/* -------------------------------------------------------------------------- */
/* Closing a row.                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Moves `patients.stage` forward only, through the same guard
 * convex/pipeline.ts uses.
 *
 * This file used to patch the stage directly, in both `finish` and `complete`,
 * and the failure branch wrote `awaiting-call`, which sits behind
 * `ready-for-review`. A duplicate or late end-of-call report carrying an empty
 * transcript therefore dragged a patient a clinician was already reviewing back
 * out of review. Vapi reports a hangup for a finished call and for one nobody
 * picked up, and both paths can fire twice, so this was reachable rather than
 * theoretical. See convex/lib/pipelineStages.ts and ADR 4.
 */
async function advance(
  ctx: MutationCtx,
  patientId: Id<'patients'>,
  stage: PipelineStage,
): Promise<void> {
  const patient = await ctx.db.get(patientId)
  if (patient && isForwardMove(patient.stage, stage)) {
    await ctx.db.patch(patientId, { stage })
  }
}

/** Where a call leaves the patient, given whether it produced anything to read. */
function stageFor(status: 'complete' | 'failed'): PipelineStage {
  return status === 'complete' ? 'ready-for-review' : 'awaiting-call'
}

/**
 * Closes the row out the moment the browser's call ends, with the live
 * transcript as a stand-in. Without this the row sits at `in-progress` until
 * the end-of-call report lands, which is seconds at best and never if the
 * assistant has no server URL, so the UI keeps claiming the call is running.
 *
 * The report overwrites the transcript when it arrives. See `complete`.
 *
 * It also schedules the transcript read. A demo runs on the browser, where this
 * is the first thing that knows the call is over, and the report behind it can
 * be a minute away on the poll or absent entirely when the assistant has no
 * server URL. Waiting for it would mean the record fills in long after the
 * clinician has looked, or never.
 *
 * Reading the live copy costs nothing in fidelity: the browser builds it with
 * `formatTurns` from the same final transcript events, so `parseTurns` splits
 * it identically. The read is claimed once, in one transaction, so whichever of
 * the two paths gets there first is the only one that runs a model, and the
 * report still overwrites the stored transcript for anyone reading it.
 */
export const finish = mutation({
  args: { vapiCallId: v.string(), transcript: v.string() },
  returns: v.null(),
  handler: async (ctx, { vapiCallId, transcript }): Promise<null> => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_vapiCallId', (q) => q.eq('vapiCallId', vapiCallId))
      .first()
    if (!call) return null
    /** The report is the better copy, so never write over one that already landed. */
    if (call.transcriptSource === 'report') return null

    const status = transcript.trim() ? ('complete' as const) : ('failed' as const)
    await ctx.db.patch(call._id, {
      transcript,
      status,
      transcriptSource: 'live',
      endedAt: Date.now(),
    })
    await advance(ctx, call.patientId, stageFor(status))
    /**
     * Scheduling from a mutation is transactional, so a `finish` that rolls
     * back leaves no job behind. A mutation cannot call an action, only
     * schedule one.
     */
    if (status === 'complete') {
      await ctx.scheduler.runAfter(0, internal.callExtract.readTranscript, { callId: call._id })
    }
    return null
  },
})

/**
 * Writes the transcript from the end-of-call report.
 * Matches on the Vapi call id because the webhook knows nothing else.
 *
 * `structured` is Vapi's own post-call extraction, shaped by the JSON schema
 * set on the assistant. Still logged rather than parsed: we now have our own
 * reader in convex/callExtract.ts, whose schema lives in this repo and can be
 * tested against a stored transcript for free, so nothing here depends on a
 * payload shape the repo has never seen. The log stays because a real payload
 * is worth seeing the first time one arrives.
 */
export const complete = internalMutation({
  args: {
    vapiCallId: v.string(),
    transcript: v.string(),
    ended: v.string(),
    structured: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { vapiCallId, transcript, ended, structured }): Promise<null> => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_vapiCallId', (q) => q.eq('vapiCallId', vapiCallId))
      .first()
    if (!call) return null

    /** Vapi reports a hangup for both a finished call and one nobody picked up. */
    const status = transcript.trim() ? ('complete' as const) : ('failed' as const)
    /** The report is canonical, so it overwrites whatever the browser saved live. */
    await ctx.db.patch(call._id, {
      transcript,
      status,
      transcriptSource: 'report',
      endedAt: call.endedAt ?? Date.now(),
    })
    await advance(ctx, call.patientId, stageFor(status))
    console.log(`[call] ${vapiCallId} ${status}, ended as ${ended}`)
    if (structured) console.log(`[call] structured ${JSON.stringify(structured)}`)

    /**
     * A duplicate report schedules a second read, and the second read loses the
     * claim in `claimTranscriptRead` and stops before any model call.
     */
    if (status === 'complete') {
      await ctx.scheduler.runAfter(0, internal.callExtract.readTranscript, { callId: call._id })
    }
    return null
  },
})

/* -------------------------------------------------------------------------- */
/* Reading the transcript back.                                                 */
/* -------------------------------------------------------------------------- */

interface TranscriptRead {
  patientId: Id<'patients'>
  vapiCallId: string
  transcript: string
  gapIds: Id<'gaps'>[]
  goals: string[]
}

/**
 * Takes the right to read this call's transcript, and hands back what reading
 * it needs. Returns null to every caller after the first.
 *
 * A mutation, so the check and the set are one transaction. The webhook and the
 * poll can both reach `complete`, and `finish` schedules a read of its own, so
 * without this the same transcript is read two or three times: two or three
 * model calls, and a duplicate set of claims and answers written by whichever
 * finished last. A query plus an action-side `if` cannot close that, because
 * the gap between the read and the write is exactly where the other caller is.
 *
 * The claim and the plan come back together deliberately. They are one read, so
 * the action starts from one consistent snapshot and one transaction rather
 * than two, and `goals` is the frozen list from `calls` rather than the gap
 * rows' current text: a re-run of the pack may have reworded a question, and an
 * answer has to resolve against what the assistant was actually told to ask.
 */
export const claimTranscriptRead = internalMutation({
  args: { callId: v.id('calls') },
  returns: v.union(
    v.null(),
    v.object({
      patientId: v.id('patients'),
      vapiCallId: v.string(),
      transcript: v.string(),
      gapIds: v.array(v.id('gaps')),
      goals: v.array(v.string()),
    }),
  ),
  handler: async (ctx, { callId }): Promise<TranscriptRead | null> => {
    const call = await ctx.db.get(callId)
    if (!call) return null
    /** Somebody else already has it, or already did it. */
    if (call.transcriptReadAt !== undefined) return null
    const transcript = call.transcript?.trim()
    /** Nothing to read. Left unclaimed, so the report's copy still gets a turn. */
    if (!transcript) return null
    /** The row has no Vapi id only before `place` attaches one, so no transcript either. */
    if (!call.vapiCallId) return null

    await ctx.db.patch(callId, { transcriptReadAt: Date.now() })
    return {
      patientId: call.patientId,
      vapiCallId: call.vapiCallId,
      transcript: call.transcript ?? '',
      gapIds: call.gapIds,
      /**
       * Absent on a row written before `goals` existed, and on one whose plan
       * was empty. Either way the answer agent has nothing to index into and is
       * skipped, while the claim agent still runs.
       */
      goals: call.goals ?? [],
    }
  },
})

/**
 * Everything a patient says on a call is `patient-reported`, whatever it sounds
 * like, so the bucket is set here and not by the caller.
 * See docs/adr/0003-three-confidence-buckets.md and convex/lib/confidence.ts.
 *
 * `verified` is the anchoring verdict, computed in convex/callExtract.ts
 * against the patient's turns alone. A false verdict does not change the
 * bucket, because a transcript claim has only one, and it does keep the claim
 * out of the recovery numerator: see `isAnchored` in
 * convex/lib/matchRecovery.ts. The claim is written either way, per ADR 3, so
 * the failure stays countable rather than invisible.
 */
export const ingestClaims = internalMutation({
  args: {
    patientId: v.id('patients'),
    vapiCallId: v.string(),
    claims: v.array(
      v.object({
        kind: claimKind,
        verbatim: v.string(),
        /** ADR 18's translation of the span. Never set on a medication. */
        resolved: v.optional(v.string()),
        quote: v.string(),
        verified: v.boolean(),
      }),
    ),
    /**
     * Written only when `patients.sex` is still absent and only when the quote
     * anchored. The degrader's pronoun path fills this field from a document;
     * a patient's own statement outranks a planted pronoun, and neither
     * outranks one already recorded. See ADR 20.
     */
    sex: v.optional(
      v.object({
        value: v.union(v.literal('male'), v.literal('female')),
        quote: v.string(),
        verified: v.boolean(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { patientId, vapiCallId, claims, sex }): Promise<number> => {
    /**
     * Clear first, so a forced re-read replaces rather than stacks. Scoped to
     * this call: `source.id` is the Vapi call id, so a second call's claims and
     * every document claim survive, which is the same scoping
     * `clearDocumentClaims` uses in the other direction.
     */
    const existing = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    for (const claim of existing) {
      if (claim.source.kind === 'transcript' && claim.source.id === vapiCallId) {
        await ctx.db.delete(claim._id)
      }
    }

    for (const claim of claims) {
      await ctx.db.insert('claims', {
        patientId,
        kind: claim.kind,
        verbatim: claim.verbatim,
        ...(claim.resolved ? { resolved: claim.resolved } : {}),
        confidence: bucketFor({ sourceKind: 'transcript', verified: claim.verified }),
        source: {
          kind: 'transcript',
          id: vapiCallId,
          quote: claim.quote,
          verified: claim.verified,
        },
      })
    }

    if (sex) {
      const patient = await ctx.db.get(patientId)
      /**
       * An unanchored sex is refused rather than demoted. There is nowhere to
       * demote it to: the field carries one confidence and a transcript's is
       * fixed at `patient-reported`, and the failure being guarded against here
       * is the assistant's own guess about a voice.
       */
      if (patient && patient.sex === undefined && sex.verified) {
        await ctx.db.patch(patientId, {
          sex: {
            value: sex.value,
            confidence: bucketFor({ sourceKind: 'transcript', verified: true }),
            source: { kind: 'transcript', id: vapiCallId, quote: sex.quote, verified: true },
          },
        })
        console.log(`[call] ${vapiCallId} settled sex as ${sex.value}`)
      }
    }

    return claims.length
  },
})

/**
 * Writes the call's answers onto the gap rows it was given.
 *
 * `goalNumber` is a one-based index into `calls.goals`, which is the numbered
 * list the assistant received, and `calls.gapIds[i]` is the row that question
 * came from. Both were frozen by one read in `create` or `register`, and
 * `create` refuses a row where the two lengths disagree, which is what makes
 * index attribution safe at all.
 *
 * Everything that does not resolve is counted and logged rather than guessed
 * at. A wrong answer written onto a real gap is invisible on the review screen,
 * while a gap left open is a visible unanswered question a clinician can act
 * on. That asymmetry is ADR 3's, applied to questions, and it decides every
 * branch below. See ADR 22.
 */
export const answerGaps = internalMutation({
  args: {
    callId: v.id('calls'),
    answers: v.array(
      v.object({
        goalNumber: v.number(),
        outcome: v.union(v.literal('answered'), v.literal('asked-and-not-known')),
        answer: v.string(),
        quote: v.string(),
        /**
         * Anchored in convex/callExtract.ts, against the patient's turns only.
         * Passed rather than recomputed here because the action has already
         * built that string to decide whether a call is worth a model at all,
         * and one definition of the verdict is worth more than a second read of
         * the transcript.
         */
        verified: v.boolean(),
      }),
    ),
  },
  returns: v.object({
    answered: v.number(),
    unanswered: v.number(),
    /** Left alone because a decision already stood on the row. */
    skipped: v.number(),
    /** Resolved to no gap, so nothing was written. */
    unmatched: v.number(),
  }),
  handler: async (
    ctx,
    { callId, answers },
  ): Promise<{ answered: number; unanswered: number; skipped: number; unmatched: number }> => {
    const result = { answered: 0, unanswered: 0, skipped: 0, unmatched: 0 }
    const call = await ctx.db.get(callId)
    if (!call) return result

    const goals = call.goals ?? []
    const seen = new Set<number>()

    for (const answer of answers) {
      const n = answer.goalNumber
      const reject = (why: string) => {
        result.unmatched++
        console.log(`[call] ${call.vapiCallId ?? callId} answer for goal ${n} ignored: ${why}`)
      }

      /** A number outside the list it was numbered from names nothing. */
      if (!Number.isInteger(n) || n < 1 || n > goals.length) {
        reject(`out of range, the call carried ${goals.length} goals`)
        continue
      }
      /** Two answers to one question disagree, and there is no rule for picking. */
      if (seen.has(n)) {
        reject('a second answer to the same goal')
        continue
      }
      seen.add(n)

      /**
       * A quote the anchor rejected came from the assistant's line, and the
       * assistant reads values back wrong on purpose to test for acquiescence.
       * A gap closed on a readback is worse than a gap left open.
       */
      if (!answer.verified) {
        reject('the quote is not one of the patient\'s own lines')
        continue
      }

      const gap = await ctx.db.get(call.gapIds[n - 1])
      /** A re-run of the pack deleted the row this question came from. */
      if (!gap) {
        reject('the gap is no longer in the database')
        continue
      }
      /** A decision already stands. A second call must not overwrite the first. */
      if (gap.status !== 'open') {
        result.skipped++
        continue
      }

      const text = answer.answer.trim()
      /**
       * `answered` with nothing in it is not an answer. Recorded as asked and
       * not known, which is the honest reading and is itself worth having:
       * asking again is pointless and a proxy is needed. See ADR 22.
       */
      const answered = answer.outcome === 'answered' && text.length > 0

      await ctx.db.patch(gap._id, {
        status: answered ? 'answered' : 'unanswered',
        ...(text ? { answer: text } : {}),
        /*
         * The quote goes on the row whichever way the verdict fell. An
         * `unanswered` gap is the more interesting one to read back: it is the
         * evidence that the question was put and the patient did not know,
         * rather than a claim that it was. See ADR 22.
         */
        answerQuote: answer.quote,
        answeredByCallId: callId,
      })
      if (answered) result.answered++
      else result.unanswered++
    }

    return result
  },
})

/* -------------------------------------------------------------------------- */
/* Placing the call.                                                            */
/* -------------------------------------------------------------------------- */

export const place = action({
  args: {
    patientId: v.id('patients'),
    /** Falls back to DEMO_PHONE_NUMBER on the deployment. */
    number: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  returns: v.object({ callId: v.id('calls'), vapiCallId: v.optional(v.string()) }),
  handler: async (
    ctx,
    { patientId, number, language },
  ): Promise<{ callId: Id<'calls'>; vapiCallId: string | undefined }> => {
    const key = process.env.VAPI_PRIVATE_KEY
    const assistantId = process.env.VAPI_ASSISTANT_ID
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID
    if (!key || !assistantId || !phoneNumberId) {
      throw new Error(
        'Set VAPI_PRIVATE_KEY, VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID with `npx convex env set`.',
      )
    }

    const dial = number ?? process.env.DEMO_PHONE_NUMBER
    if (!dial) {
      throw new Error('No number to call. Set DEMO_PHONE_NUMBER with `npx convex env set`.')
    }
    /**
     * Vapi rejects anything that is not E.164, and a UK number written the way
     * people say it out loud is the common mistake.
     */
    if (!/^\+[1-9]\d{7,14}$/.test(dial)) {
      throw new Error(
        `DEMO_PHONE_NUMBER is "${dial}", which Vapi will reject. It needs the international ` +
          'form: drop the leading zero and put the country code on, so 07700 900000 becomes ' +
          '+447700900000.',
      )
    }

    /** One read. The ids and the numbered questions are the same list. */
    const plan = await ctx.runQuery(internal.call.callPlan, { patientId })
    if (!plan) throw new Error('That patient does not exist.')
    const goals = plan.selected.map((gap) => gap.question)

    const callId = await ctx.runMutation(internal.call.create, {
      patientId,
      language,
      gapIds: plan.selected.map((gap) => gap.gapId),
      goals,
      status: 'pending',
    })

    const response = await fetch(`${VAPI_ORIGIN}/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: dial },
        assistantOverrides: {
          /** Names here must match the placeholders in the dashboard prompt. */
          variableValues: {
            patientName: plan.patientName,
            patientAge: String(plan.patientAge),
            patientDob: plan.patientDob,
            goals:
              numberedGoals(goals) || 'Nothing specific is outstanding. Work the call plan.',
          },
        },
      }),
    })

    if (!response.ok) {
      await ctx.runMutation(internal.call.markFailed, { callId })
      throw new Error(`Vapi returned ${response.status}: ${await response.text()}`)
    }

    const { id } = (await response.json()) as { id?: string }
    /** Without an id the report can never find this row, so it would sit pending forever. */
    if (!id) {
      await ctx.runMutation(internal.call.markFailed, { callId })
      throw new Error('Vapi accepted the call but returned no id, so its transcript is unreachable.')
    }

    await ctx.runMutation(internal.call.attachVapiId, { callId, vapiCallId: id })
    await ctx.scheduler.runAfter(FIRST_POLL_MS, internal.call.poll, {
      callId,
      vapiCallId: id,
      attempt: 0,
    })
    return { callId, vapiCallId: id }
  },
})

export const state = internalQuery({
  args: { callId: v.id('calls') },
  returns: v.union(
    v.null(),
    v.object({
      status: callStatus,
      transcriptSource: v.optional(v.union(v.literal('live'), v.literal('report'))),
    }),
  ),
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId)
    return call ? { status: call.status, transcriptSource: call.transcriptSource } : null
  },
})

/**
 * Asks Vapi how the call went, for the rows the end-of-call report never
 * reaches: the phone path has no browser to fall back on, and a missing or
 * wrong server URL on the assistant silences the webhook entirely.
 *
 * Re-arms itself until the call ends or the run is clearly over.
 */
export const poll = internalAction({
  args: { callId: v.id('calls'), vapiCallId: v.string(), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { callId, vapiCallId, attempt }): Promise<null> => {
    const current = await ctx.runQuery(internal.call.state, { callId })
    if (!current) return null
    /**
     * Keyed on the transcript source rather than on the status. `finish` sets
     * `status: 'complete'` from the browser the instant the call ends, and this
     * used to read that as "somebody else got there first" and stop, so the
     * report path never ran for a browser call and nothing ever asked Vapi for
     * the canonical transcript. A demo runs on the browser, so that was the
     * common case rather than the edge one. The report having landed is the one
     * outcome that genuinely needs no poll.
     */
    if (current.transcriptSource === 'report') return null

    const key = process.env.VAPI_PRIVATE_KEY
    if (!key) return null

    const response = await fetch(`${VAPI_ORIGIN}/call/${vapiCallId}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (response.ok) {
      const call = (await response.json()) as {
        status?: string
        endedReason?: string
        artifact?: { transcript?: string }
      }
      if (call.status === 'ended') {
        await ctx.runMutation(internal.call.complete, {
          vapiCallId,
          transcript: call.artifact?.transcript ?? '',
          ended: call.endedReason ?? 'unknown',
        })
        return null
      }
    }

    if (attempt + 1 >= MAX_POLLS) {
      /** Nothing has come back in twenty minutes, so stop telling the board it is running. */
      await ctx.runMutation(internal.call.markFailed, { callId })
      console.log(`[call] ${vapiCallId} gave up after ${MAX_POLLS} polls`)
      return null
    }
    await ctx.scheduler.runAfter(POLL_EVERY_MS, internal.call.poll, {
      callId,
      vapiCallId,
      attempt: attempt + 1,
    })
    return null
  },
})
