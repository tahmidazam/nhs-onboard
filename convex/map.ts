import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { normalise, resolveBrand } from './brands'
import { bucketFor } from './lib/confidence'
import { looksTranslated } from './lib/guard'

/**
 * The mapping pass: every medication claim on a patient against the dm+d chain,
 * and the guard that stops a model doing the mapping itself.
 *
 * No model call runs here, which is why this is its own PipelineStage rather
 * than the tail of extraction. Reseeding a brand dataset re-runs the lookup for
 * nothing, per docs/adr/0016-extraction-is-the-only-model-stage.md.
 *
 * `Claim.resolved` on a medication comes from dm+d and from nowhere else. The
 * extraction agent's transliteration feeds the lookup and never replaces it:
 * that is the whole of docs/adr/0002-drug-mapping-is-deterministic.md, and
 * docs/adr/0011-recovery-is-measured-against-a-frozen-snapshot.md scores
 * medications on the `ukIngredient` this writes. Conditions, allergies and
 * immunisations take `resolved` from the agent's `english` field under
 * docs/adr/0018-translation-sits-in-the-recovery-path.md and are not touched
 * here.
 *
 * `unresolved: true` is a correct answer, not a failure. Metamizole and
 * drotaverine have no UK equivalent, so the claim is demoted to
 * `uncertain-mapping` and shown verbatim.
 */

const VIA = ['bd-medex', 'indian-medicines', 'idd', 'rxnav', 'unresolved'] as const
type Via = (typeof VIA)[number]

/** `brands.via` is a free string in the table, so it is narrowed on the way in. */
function toVia(raw: string | undefined): Via {
  return (VIA as readonly string[]).includes(raw ?? '') ? (raw as Via) : 'unresolved'
}

/**
 * The Latin-script string the lookup is keyed on.
 *
 * The medication agent returns `latin` beside `verbatim` and extraction seeds
 * `mapping.brand` with it, which is the contract between the two stages and the
 * reason this one re-runs on a reseeded dataset without a model call. A `latin`
 * column is read first should the claims table ever grow one.
 *
 * `verbatim` is the fallback, for claims extraction never saw: a transcript
 * claim from the call carries no transliteration, and a Latin brand is its own.
 */
function transliterationOf(claim: Doc<'claims'> & { latin?: string }): string {
  return claim.latin?.trim() || claim.mapping?.brand?.trim() || claim.verbatim
}

/**
 * Whether a string is an exact dm+d VTM name, under the same normalisation the
 * seeder keys the table on. Exact, not the prefix match `resolveBrand` uses:
 * the signature being caught is a model returning the ingredient itself.
 */
async function isVtmName(ctx: MutationCtx, latin: string): Promise<boolean> {
  const key = normalise(latin)
  if (!key) return false
  const hit = await ctx.db
    .query('dmd')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first()
  return hit !== null
}

export interface MappingPass {
  /** Medication claims seen. */
  claims: number
  /** Claims carrying a UK ingredient afterwards. */
  resolved: number
  /** Claims demoted to `uncertain-mapping`, including the rejected ones. */
  unresolved: number
  /** Of those, the ones the transliteration guard refused. */
  rejected: number
}

const pass = v.object({
  claims: v.number(),
  resolved: v.number(),
  unresolved: v.number(),
  rejected: v.number(),
})

async function mapClaims(ctx: MutationCtx, patientId: Id<'patients'>): Promise<MappingPass> {
  const claims = await ctx.db
    .query('claims')
    .withIndex('by_patient', (q) => q.eq('patientId', patientId))
    .collect()

  const result: MappingPass = { claims: 0, resolved: 0, unresolved: 0, rejected: 0 }

  for (const claim of claims) {
    if (claim.kind !== 'medication') continue
    result.claims++

    const latin = transliterationOf(claim)

    /**
     * One normalised lookup per medication claim, and it catches the only
     * translation failure that moves the metric in our favour. See ADR 18.
     */
    const rejected = looksTranslated(claim.verbatim, latin, await isVtmName(ctx, latin))
    const resolution = rejected ? null : await resolveBrand(ctx, latin)

    /**
     * `resolveBrand` reports `unresolved` against the brand datasets, which is
     * a different question to the one asked here. No-Spa resolves to
     * drotaverine and Analgin to metamizole, neither is UK-licensed, and dm+d
     * carries no VTM for either, so the brand lookup succeeds and the mapping
     * still has no UK ingredient. ADR 2 calls that result correct rather than
     * failed. `Claim.resolved` and ADR 11's medication match both key on the
     * `ukIngredient` that is missing, so a mapping without one is unresolved
     * here whatever the brand datasets said, and the claim shows verbatim.
     */
    const unresolved =
      rejected || resolution === null || resolution.unresolved || !resolution.ukIngredient

    if (rejected) result.rejected++
    if (unresolved) result.unresolved++
    else result.resolved++

    await ctx.db.patch(claim._id, {
      confidence: bucketFor({
        sourceKind: claim.source.kind,
        verified: claim.source.verified,
        mappingUnresolved: unresolved,
      }),
      /**
       * dm+d or nothing. A model's `english` never reaches this field on a
       * medication, and `verbatim` is never overwritten, so a rejected or
       * unresolved claim still shows as the document wrote it. `undefined`
       * clears a value a previous run left, which is what makes a re-run after
       * a reseed truthful rather than additive.
       */
      resolved: unresolved ? undefined : resolution?.ukIngredient,
      /**
       * What the datasets said, kept as they said it: No-Spa comes back as
       * drotaverine with `unresolved: true`, which reads as identified and not
       * UK-licensed rather than as a miss. A rejected claim keeps nothing,
       * because the route that produced it is the thing in doubt.
       */
      mapping:
        rejected || resolution === null
          ? { brand: latin, via: 'unresolved' as const, unresolved: true }
          : {
              brand: latin,
              generic: resolution.generic,
              ukIngredient: resolution.ukIngredient,
              prescribable: resolution.prescribable,
              vmpId: resolution.vmpId,
              ukFormularyName: resolution.ukFormularyName,
              rag: resolution.rag,
              via: toVia(resolution.via),
              unresolved,
            },
    })
  }

  /**
   * Coarse, per ADR 16, and only forward. Extraction leaves the patient at
   * `mapping` and stops; a re-run of this pass against a patient further down
   * the pipeline re-reads the datasets without dragging the board backwards.
   */
  const patient = await ctx.db.get(patientId)
  if (patient?.stage === 'mapping') await ctx.db.patch(patientId, { stage: 'applying-rules' })

  return result
}

/** Called by the extraction action once every agent has settled. */
export const mapPatient = internalMutation({
  args: { patientId: v.id('patients') },
  returns: pass,
  handler: async (ctx, { patientId }) => mapClaims(ctx, patientId),
})

/**
 * The operator's re-run. Public because reseeding a brand dataset and mapping
 * again is a thing done from the board, and it costs no model call.
 */
export const run = mutation({
  args: { patientId: v.id('patients') },
  returns: pass,
  handler: async (ctx, { patientId }) => mapClaims(ctx, patientId),
})
