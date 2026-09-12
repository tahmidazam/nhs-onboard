import { v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
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
    }),
  ),
  handler: async (ctx, { patientId }) => {
    const call = await ctx.db
      .query('calls')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .order('desc')
      .first()
    if (!call) return null
    return { channel: call.channel, status: call.status, transcript: call.transcript }
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
  handler: async (ctx, { patientId, vapiCallId, language }) =>
    ctx.db.insert('calls', {
      patientId,
      vapiCallId,
      language,
      channel: 'voice',
      status: 'in-progress',
      gapIds: [],
    }),
})

export const markFailed = internalMutation({
  args: { callId: v.id('calls') },
  returns: v.null(),
  handler: async (ctx, { callId }) => {
    await ctx.db.patch(callId, { status: 'failed' })
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
    await ctx.db.patch(call._id, { transcript, status })
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
    if (id) await ctx.runMutation(internal.call.attachVapiId, { callId, vapiCallId: id })
    return { callId, vapiCallId: id }
  },
})
