import { v } from 'convex/values'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

/**
 * Places the outbound call and stores the transcript Vapi sends back.
 *
 * The assistant lives in the Vapi dashboard so its script can be retuned
 * without a deploy. This file passes the patient's open gaps in as variables
 * and never sends prompt text.
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

export const openGaps = internalQuery({
  args: { patientId: v.id('patients') },
  returns: v.array(v.object({ _id: v.id('gaps'), question: v.string() })),
  handler: async (ctx, { patientId }) => {
    const gaps = await ctx.db
      .query('gaps')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    return gaps
      .filter((g) => g.status === 'open')
      .map((g) => ({ _id: g._id, question: g.question }))
  },
})

/** Whole number of years at the sim's current date. */
function ageFrom(birthDate: string, now: number): number {
  const born = new Date(birthDate)
  const today = new Date(now)
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const month = today.getUTCMonth() - born.getUTCMonth()
  if (month < 0 || (month === 0 && today.getUTCDate() < born.getUTCDate())) age--
  return age
}

/**
 * Everything the assistant's prompt reads as variables. One source, so the
 * phone and browser paths cannot drift apart.
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
    }),
  ),
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get(patientId)
    if (!patient) return null
    const gaps = await ctx.db
      .query('gaps')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    return {
      patientName: patient.name,
      patientAge: ageFrom(patient.birthDate, Date.now()),
      patientDob: patient.birthDate,
      goals: gaps.filter((g) => g.status === 'open').map((g) => g.question),
    }
  },
})

export const latestCall = query({
  args: { patientId: v.id('patients') },
  returns: v.union(
    v.null(),
    v.object({
      channel: v.union(v.literal('voice'), v.literal('chat')),
      status: v.union(
        v.literal('pending'),
        v.literal('in-progress'),
        v.literal('complete'),
        v.literal('failed'),
      ),
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

export const create = internalMutation({
  args: {
    patientId: v.id('patients'),
    vapiCallId: v.optional(v.string()),
    language: v.optional(v.string()),
    gapIds: v.array(v.id('gaps')),
    status: v.union(
      v.literal('pending'),
      v.literal('in-progress'),
      v.literal('complete'),
      v.literal('failed'),
    ),
  },
  returns: v.id('calls'),
  handler: async (ctx, args) => ctx.db.insert('calls', { ...args, channel: 'voice' as const }),
})

/**
 * Registers a call the browser placed, so the end-of-call report has a row to
 * write into. The phone path inserts its own row in `place`.
 */
export const register = mutation({
  args: {
    patientId: v.id('patients'),
    vapiCallId: v.string(),
    language: v.optional(v.string()),
  },
  returns: v.id('calls'),
  handler: async (ctx, { patientId, vapiCallId, language }) => {
    const callId = await ctx.db.insert('calls', {
      patientId,
      vapiCallId,
      language,
      channel: 'voice',
      status: 'in-progress',
      gapIds: [],
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

/**
 * Closes the row out the moment the browser's call ends, with the live
 * transcript as a stand-in. Without this the row sits at `in-progress` until
 * the end-of-call report lands, which is seconds at best and never if the
 * assistant has no server URL, so the UI keeps claiming the call is running.
 *
 * The report overwrites this when it arrives. See `complete`.
 */
export const finish = mutation({
  args: { vapiCallId: v.string(), transcript: v.string() },
  returns: v.null(),
  handler: async (ctx, { vapiCallId, transcript }) => {
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
    await ctx.db.patch(call.patientId, {
      stage: status === 'complete' ? ('ready-for-review' as const) : ('awaiting-call' as const),
    })
    return null
  },
})

export const markFailed = internalMutation({
  args: { callId: v.id('calls') },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    await ctx.db.patch(callId, { status: 'failed', endedAt: Date.now() })
    return null
  },
})

export const attachVapiId = internalMutation({
  args: { callId: v.id('calls'), vapiCallId: v.string() },
  returns: v.null(),
  handler: async (ctx, { callId, vapiCallId }) => {
    await ctx.db.patch(callId, { vapiCallId, status: 'in-progress' })
    return null
  },
})

/**
 * Writes the transcript from the end-of-call report.
 * Matches on the Vapi call id because the webhook knows nothing else.
 *
 * `structured` is Vapi's own post-call extraction, shaped by the JSON schema set
 * on the assistant. This logs it rather than parsing it, until one real payload
 * shows what the dashboard schema produces.
 */
export const complete = internalMutation({
  args: {
    vapiCallId: v.string(),
    transcript: v.string(),
    ended: v.string(),
    structured: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { vapiCallId, transcript, ended, structured }) => {
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
    await ctx.db.patch(call.patientId, {
      stage: status === 'complete' ? ('ready-for-review' as const) : ('awaiting-call' as const),
    })
    console.log(`[call] ${vapiCallId} ${status}, ended as ${ended}`)
    if (structured) console.log(`[call] structured ${JSON.stringify(structured)}`)
    return null
  },
})

/**
 * Everything a patient says on a call is `patient-reported`, whatever it sounds
 * like. This is the only writer of transcript-sourced claims, so the bucket is
 * set here and not by the caller.
 * See docs/adr/0003-three-confidence-buckets.md.
 */
export const ingestClaims = internalMutation({
  args: {
    patientId: v.id('patients'),
    vapiCallId: v.string(),
    claims: v.array(
      v.object({
        kind: v.union(
          v.literal('medication'),
          v.literal('condition'),
          v.literal('immunisation'),
          v.literal('family-history'),
          v.literal('allergy'),
        ),
        verbatim: v.string(),
        quote: v.string(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { patientId, vapiCallId, claims }) => {
    for (const claim of claims) {
      await ctx.db.insert('claims', {
        patientId,
        kind: claim.kind,
        verbatim: claim.verbatim,
        confidence: 'patient-reported',
        source: { kind: 'transcript', id: vapiCallId, quote: claim.quote },
      })
    }
    return claims.length
  },
})

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

    const gaps = await ctx.runQuery(internal.call.openGaps, { patientId })
    const context = await ctx.runQuery(api.call.callContext, { patientId })
    if (!context) throw new Error('That patient does not exist.')

    const callId = await ctx.runMutation(internal.call.create, {
      patientId,
      language,
      gapIds: gaps.map((g) => g._id),
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
            patientName: context.patientName,
            patientAge: String(context.patientAge),
            patientDob: context.patientDob,
            goals:
              context.goals.map((q, i) => `${i + 1}. ${q}`).join('\n') ||
              'Nothing specific is outstanding. Work the call plan.',
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
      status: v.union(
        v.literal('pending'),
        v.literal('in-progress'),
        v.literal('complete'),
        v.literal('failed'),
      ),
    }),
  ),
  handler: async (ctx, { callId }) => {
    const call = await ctx.db.get(callId)
    return call ? { status: call.status } : null
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
  handler: async (ctx, { callId, vapiCallId, attempt }) => {
    const current = await ctx.runQuery(internal.call.state, { callId })
    /** The report or the browser got there first, which is the normal outcome. */
    if (!current || current.status === 'complete' || current.status === 'failed') return null

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
