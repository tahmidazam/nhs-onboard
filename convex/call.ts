import { v } from 'convex/values'
import { action, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'

/**
 * Places the outbound call and records what comes back.
 *
 * The assistant lives in the Vapi dashboard so its script can be retuned
 * without a deploy. This file passes the patient's open gaps in as variables
 * and never sends prompt text.
 */

const VAPI_ORIGIN = 'https://api.vapi.ai'

/** Long enough for someone to find a ringing phone in a noisy room. */
const CUSTOMER_JOIN_TIMEOUT_SECONDS = 45

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
 */
export const recordTranscript = internalMutation({
  args: { vapiCallId: v.string(), transcript: v.string(), ended: v.string() },
  returns: v.null(),
  handler: async (ctx, { vapiCallId, transcript, ended }) => {
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
  args: { patientId: v.id('patients'), number: v.string(), language: v.optional(v.string()) },
  returns: v.object({ callId: v.id('calls'), vapiCallId: v.optional(v.string()) }),
  handler: async (ctx, { patientId, number, language }) => {
    const key = process.env.VAPI_PRIVATE_KEY
    const assistantId = process.env.VAPI_ASSISTANT_ID
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID
    if (!key || !assistantId || !phoneNumberId) {
      throw new Error(
        'Set VAPI_PRIVATE_KEY, VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID with `npx convex env set`.',
      )
    }

    const gaps = await ctx.runQuery(internal.call.openGaps, { patientId })
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
        customer: { number },
        assistantOverrides: {
          customerJoinTimeoutSeconds: CUSTOMER_JOIN_TIMEOUT_SECONDS,
          /** The dashboard prompt reads {{goals}}. Keep the placeholder in step with it. */
          variableValues: {
            goals: gaps.map((g, i) => `${i + 1}. ${g.question}`).join('\n') || 'No open questions.',
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
