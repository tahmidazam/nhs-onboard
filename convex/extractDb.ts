import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'

/**
 * The database half of extraction.
 *
 * Split from convex/extract.ts because that file carries `"use node"` for
 * @openai/agents, and a Node-runtime module can export actions only. Every read
 * and write the extraction action needs lives here, and nothing here calls a
 * model.
 */

const claimKind = v.union(
  v.literal('medication'),
  v.literal('condition'),
  v.literal('immunisation'),
  v.literal('family-history'),
  v.literal('allergy'),
)

const confidence = v.union(
  v.literal('document-evidenced'),
  v.literal('patient-reported'),
  v.literal('uncertain-mapping'),
)

/**
 * What one agent item becomes. `kind`, `source` and `confidence` are all filled
 * by code in convex/extract.ts; `mapping` carries the transliteration forward
 * unresolved, for convex/map.ts to resolve.
 */
export const claimDraft = v.object({
  kind: claimKind,
  verbatim: v.string(),
  resolved: v.optional(v.string()),
  confidence,
  source: v.object({
    kind: v.literal('document'),
    id: v.string(),
    quote: v.string(),
    verified: v.boolean(),
  }),
  mapping: v.optional(
    v.object({
      brand: v.string(),
      via: v.literal('unresolved'),
      unresolved: v.boolean(),
    }),
  ),
})

/**
 * How many stored claims came from a document. Non-zero means extraction has
 * already run for this patient and is skipped, per ADR 10's treatment of the
 * degrader: documents are frozen, so re-extraction only ever fixes our own
 * bugs, and it costs sixteen model calls and the latency the demo can least
 * afford.
 *
 * `collect` is bounded here by the claims one patient's documents can produce,
 * which is tens.
 */
export const documentClaimCount = internalQuery({
  args: { patientId: v.id('patients') },
  returns: v.number(),
  handler: async (ctx, { patientId }) => {
    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    return claims.filter((claim) => claim.source.kind === 'document').length
  },
})

/** The documents to fan out over. Text only: nothing else reaches an agent. */
export const documents = internalQuery({
  args: { patientId: v.id('patients') },
  returns: v.array(v.object({ _id: v.id('documents'), text: v.string() })),
  handler: async (ctx, { patientId }) => {
    const rows = await ctx.db
      .query('documents')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    return rows.map((row) => ({ _id: row._id, text: row.text }))
  },
})

/**
 * The one stage write before the fan-out, per ADR 16. `extracting` is set once
 * and no agent writes `patients.stage`: sixteen parallel writers to one linear
 * enum contend, and the enum cannot express nine of sixteen. Live progress on
 * the board is the claim count, which Convex is already reactive over.
 *
 * Clearing `extractionFailures` here rather than on completion means a run's
 * failures always belong to that run.
 */
export const begin = internalMutation({
  args: { patientId: v.id('patients') },
  returns: v.null(),
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get(patientId)
    if (!patient) throw new Error(`No patient ${patientId}`)
    await ctx.db.patch(patientId, { stage: 'extracting', extractionFailures: undefined })
    return null
  },
})

/**
 * The one stage write after it. `mapping` and not `applying-rules`: the
 * deterministic lookup in convex/map.ts advances it the rest of the way, which
 * is what lets a reseeded brand dataset re-run the lookup without re-running a
 * model call.
 */
export const finish = internalMutation({
  args: { patientId: v.id('patients') },
  returns: v.null(),
  handler: async (ctx, { patientId }) => {
    await ctx.db.patch(patientId, { stage: 'mapping' })
    return null
  },
})

/**
 * One agent's claims, written as that agent resolves rather than batched to the
 * end, so the board's claim count climbs during the stage.
 */
export const insertClaims = internalMutation({
  args: { patientId: v.id('patients'), claims: v.array(claimDraft) },
  returns: v.number(),
  handler: async (ctx, { patientId, claims }) => {
    for (const claim of claims) await ctx.db.insert('claims', { patientId, ...claim })
    return claims.length
  },
})

/** Appends a failed call to the patient. Recorded, never swallowed. */
export const recordFailure = internalMutation({
  args: {
    patientId: v.id('patients'),
    documentId: v.id('documents'),
    agent: v.string(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { patientId, documentId, agent, message }) => {
    const patient = await ctx.db.get(patientId)
    if (!patient) return null
    await ctx.db.patch(patientId, {
      extractionFailures: [...(patient.extractionFailures ?? []), { documentId, agent, message }],
    })
    return null
  },
})

/**
 * Deletes document-sourced claims only.
 *
 * `transcript` and `sim-record` claims are never touched by extraction in
 * either direction. A transcript claim is what the patient told us on the call
 * and a sim-record claim is a frozen snapshot fact; losing either on a re-run
 * would discard something extraction never produced and cannot reproduce.
 */
export const clearDocumentClaims = internalMutation({
  args: { patientId: v.id('patients') },
  returns: v.number(),
  handler: async (ctx, { patientId }) => {
    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    const stale = claims.filter((claim) => claim.source.kind === 'document')
    for (const claim of stale) await ctx.db.delete(claim._id)
    return stale.length
  },
})
