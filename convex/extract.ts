'use node'

import { v } from 'convex/values'
import { Agent, run as runAgent, setDefaultOpenAIKey } from '@openai/agents'
import { action } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { anchor } from './lib/anchor'
import { bucketFor } from './lib/confidence'
import { EXTRACTION_AGENTS, claimKindFor, type ExtractionAgent } from './lib/agents'
import type { ClaimKind, Confidence } from '../src/types'

/**
 * Extraction: PresentedDocuments in, Claims out. The only stage where a model
 * touches clinical content, per docs/adr/0016-extraction-is-the-only-model-stage.md.
 *
 * `"use node"` because @openai/agents does not run in the default Convex
 * runtime, which is also why the reads and writes live in convex/extractDb.ts:
 * a Node-runtime module can export actions only.
 *
 * This file performs model calls and database writes and delegates every
 * decision to convex/lib/, so the seam count stays at one. There is no
 * branching here on what a drug or a condition means.
 *
 * Four agents run over each document, fanned out with `Promise.all`, so a
 * patient with four documents costs sixteen calls. An agent sees exactly one
 * document. That is what stops it merging facts across two, and it is a design
 * constraint rather than an artefact of the loop: documents are never
 * concatenated.
 *
 * `source.kind` and `source.id` are written here from the document being
 * processed and are never returned by a model. The model supplies `quote`, and
 * `anchor` decides whether it holds.
 */

/** Per ADR 6 the strong model. Overridable per deployment without a code change. */
const MODEL = process.env.EXTRACTION_MODEL

const summary = v.object({
  /** True when stored document claims were reused and no model call was made. */
  skipped: v.boolean(),
  documents: v.number(),
  claims: v.number(),
  /** Calls that failed twice. Each one is also recorded on the patient. */
  failures: v.number(),
})

interface Summary {
  skipped: boolean
  documents: number
  claims: number
  failures: number
}

interface ClaimDraft {
  kind: ClaimKind
  verbatim: string
  resolved?: string
  confidence: Confidence
  source: { kind: 'document'; id: string; quote: string; verified: boolean }
  mapping?: { brand: string; via: 'unresolved'; unresolved: boolean }
}

interface SourceDocument {
  _id: Id<'documents'>
  text: string
}

/* -------------------------------------------------------------------------- */
/* Reading an agent's output.                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The union of the four agents' item shapes, flattened to the fields a Claim
 * can hold. `dose`, `frequency`, `reactionText` and `dateText` are returned by
 * the agents and dropped here: `Claim` is the shared contract and carries
 * nowhere to put them.
 */
interface ExtractedItem {
  verbatim: string
  quote: string
  /** Translation of the span, per ADR 18. Absent on medications by design. */
  english?: string
  /** Transliteration of a brand name, per ADR 2. Medications only. */
  latin?: string
  /** The condition agent's discriminator. `claimKindFor` maps it back. */
  subject?: 'patient' | 'family'
}

/**
 * A field the document did not give comes back `null` rather than missing:
 * strict Structured Outputs rejects an optional that is not also nullable, so
 * the schemas declare every field required and nullable.
 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readItem(raw: unknown): ExtractedItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const item = raw as Record<string, unknown>
  const verbatim = text(item.verbatim)
  const quote = text(item.quote)
  /** Neither is anchorable when empty, and an empty quote anchors anything. */
  if (!verbatim || !quote) return null
  const subject = item.subject
  return {
    verbatim,
    quote,
    english: text(item.english),
    latin: text(item.latin),
    subject: subject === 'patient' || subject === 'family' ? subject : undefined,
  }
}

/** Every agent's output is a top-level object with an `items` array. */
function itemsOf(output: unknown): ExtractedItem[] {
  const items = (output as { items?: unknown } | null | undefined)?.items
  if (!Array.isArray(items)) return []
  return items.map(readItem).filter((item): item is ExtractedItem => item !== null)
}

/**
 * One item, anchored and bucketed, ready to insert.
 *
 * An item that fails anchoring is still written: demoted to `uncertain-mapping`
 * with `verified: false` and its unverified quote retained, per ADR 3 and ADR
 * 17. Dropping it would make the failure unobservable, and "extraction proposed
 * forty claims and thirty-eight anchored" is a sentence we want to be able to
 * say.
 */
function toDraft(
  definition: ExtractionAgent,
  item: ExtractedItem,
  document: SourceDocument,
): ClaimDraft {
  const anchored = anchor(document.text, item.quote, item.verbatim)

  /**
   * Not a mapping: the transliteration, carried forward unresolved so
   * convex/map.ts has something to feed `brands.resolve`. No brand lookup runs
   * here, and `Claim.resolved` for a medication is left to the dm+d lookup.
   */
  const mapping = item.latin
    ? { brand: item.latin, via: 'unresolved' as const, unresolved: true }
    : undefined

  return {
    /** The condition agent covers two kinds; the other three cover one each. */
    kind: item.subject ? claimKindFor(item.subject) : definition.kinds[0],
    verbatim: item.verbatim,
    /** ADR 18: a translation of the span. Medications carry none. */
    ...(item.english ? { resolved: item.english } : {}),
    confidence: bucketFor({
      sourceKind: 'document',
      verified: anchored.verified,
      mappingUnresolved: mapping?.unresolved,
    }),
    source: {
      kind: 'document',
      id: document._id,
      quote: item.quote,
      verified: anchored.verified,
    },
    ...(mapping ? { mapping } : {}),
  }
}

/* -------------------------------------------------------------------------- */
/* The fan-out.                                                                 */
/* -------------------------------------------------------------------------- */

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}

/**
 * One retry, and no more. A third attempt buys little against a model that has
 * refused twice, and costs the demo the latency it can least afford.
 */
async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt()
  } catch {
    return await attempt()
  }
}

/**
 * One agent over one document. Never throws: a failed call contributes no
 * claims and the failure is recorded on the patient, so the fan-out settles
 * either way and a document that yielded nothing because a call failed stays
 * distinguishable from one that genuinely held nothing.
 */
async function extractOne(
  ctx: ActionCtx,
  patientId: Id<'patients'>,
  document: SourceDocument,
  definition: ExtractionAgent,
): Promise<{ claims: number; failed: boolean }> {
  const agent = new Agent({
    name: definition.name,
    instructions: definition.prompt,
    outputType: definition.outputType,
    ...(MODEL ? { model: MODEL } : {}),
  })

  try {
    /** Static instructions at the front, the document at the back, per ADR 6. */
    const output = await withRetry(async () => (await runAgent(agent, document.text)).finalOutput)
    const drafts = itemsOf(output).map((item) => toDraft(definition, item, document))
    if (drafts.length === 0) return { claims: 0, failed: false }
    const written: number = await ctx.runMutation(internal.extractDb.insertClaims, {
      patientId,
      claims: drafts,
    })
    return { claims: written, failed: false }
  } catch (error) {
    await ctx.runMutation(internal.extractDb.recordFailure, {
      patientId,
      documentId: document._id,
      agent: definition.name,
      message: messageOf(error),
    })
    console.error(`[extract] ${definition.name} failed on ${document._id}: ${messageOf(error)}`)
    return { claims: 0, failed: true }
  }
}

/**
 * The whole stage. Two stage writes bracket the fan-out and nothing writes
 * `patients.stage` in between.
 */
async function extractAll(ctx: ActionCtx, patientId: Id<'patients'>): Promise<Summary> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('Set OPENAI_API_KEY with `npx convex env set`.')
  setDefaultOpenAIKey(key)

  const docs = await ctx.runQuery(internal.extractDb.documents, { patientId })
  await ctx.runMutation(internal.extractDb.begin, { patientId })

  const results = await Promise.all(
    docs.flatMap((document) =>
      EXTRACTION_AGENTS.map((definition) => extractOne(ctx, patientId, document, definition)),
    ),
  )

  await ctx.runMutation(internal.extractDb.finish, { patientId })

  /**
   * The orchestrator is code, per ADR 4, so the mapping pass is called rather
   * than scheduled: the action returns once the patient has actually reached
   * `applying-rules`. The pass advances the stage itself.
   */
  const mapping = await ctx.runMutation(internal.map.mapPatient, { patientId })

  const claims = results.reduce((total, result) => total + result.claims, 0)
  const failures = results.filter((result) => result.failed).length
  console.log(
    `[extract] ${patientId}: ${docs.length} documents, ${results.length} calls, ${claims} claims, ${failures} failures, ${mapping.resolved} mapped, ${mapping.rejected} rejected`,
  )
  return { skipped: false, documents: docs.length, claims, failures }
}

/* -------------------------------------------------------------------------- */
/* The two entry points.                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The pipeline's extraction stage. Skipped when document-sourced claims already
 * exist, so repeating the demo costs no model calls and the number quoted to a
 * judge a minute ago is still true.
 */
export const run = action({
  args: { patientId: v.id('patients') },
  returns: summary,
  handler: async (ctx, { patientId }): Promise<Summary> => {
    const existing: number = await ctx.runQuery(internal.extractDb.documentClaimCount, {
      patientId,
    })
    if (existing > 0) {
      console.log(`[extract] ${patientId}: ${existing} document claims stored, skipping`)
      return { skipped: true, documents: 0, claims: existing, failures: 0 }
    }
    return extractAll(ctx, patientId)
  },
})

/**
 * The explicit operator route, for iterating while building. Deletes the
 * patient's document-sourced claims and runs again. Transcript and sim-record
 * claims are left alone, so re-running never discards what the patient told us
 * on the call.
 */
export const reExtract = action({
  args: { patientId: v.id('patients') },
  returns: summary,
  handler: async (ctx, { patientId }): Promise<Summary> => {
    const deleted: number = await ctx.runMutation(internal.extractDb.clearDocumentClaims, {
      patientId,
    })
    console.log(`[extract] ${patientId}: deleted ${deleted} document claims before re-extracting`)
    return extractAll(ctx, patientId)
  },
})
