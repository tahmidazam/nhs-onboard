import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { resolveBrand } from './brands'
import type { Resolution } from './brands'

/**
 * Maps every medication claim on a patient to a UK product and sets the bucket
 * the review UI routes it by.
 *
 * No model runs in this path. See docs/adr/0002-drug-mapping-is-deterministic.md.
 */

const VIA = ['bd-medex', 'indian-medicines', 'idd', 'rxnav', 'unresolved'] as const
type Via = (typeof VIA)[number]

function toVia(raw: string): Via {
  return (VIA as readonly string[]).includes(raw) ? (raw as Via) : 'unresolved'
}

/**
 * A mapping is safe to prescribe from only when a document carried it and dm+d
 * gave back a prescribable product. Everything else keeps the clinician in the
 * loop. See docs/adr/0003-three-confidence-buckets.md.
 */
export function bucketFor(
  claim: Pick<Doc<'claims'>, 'confidence' | 'source'>,
  resolution: Resolution | null,
): Doc<'claims'>['confidence'] {
  if (!resolution || resolution.unresolved || !resolution.prescribable) return 'uncertain-mapping'
  if (claim.source.kind !== 'document') return 'patient-reported'
  return 'document-evidenced'
}

export const mapPatient = internalMutation({
  args: { patientId: v.id('patients') },
  returns: v.object({ mapped: v.number(), unresolved: v.number() }),
  handler: async (ctx, { patientId }) => {
    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()

    let mapped = 0
    let unresolved = 0

    for (const claim of claims) {
      if (claim.kind !== 'medication') continue

      const resolution = await resolveBrand(ctx, claim.verbatim)
      const confidence = bucketFor(claim, resolution)
      if (confidence === 'uncertain-mapping') unresolved++
      else mapped++

      await ctx.db.patch(claim._id, {
        confidence,
        /** The verbatim string is never overwritten, so an unresolved claim shows as written. */
        resolved: resolution?.prescribable ?? resolution?.ukIngredient ?? undefined,
        mapping: {
          brand: resolution?.brand ?? claim.verbatim,
          generic: resolution?.generic,
          ukIngredient: resolution?.ukIngredient,
          prescribable: resolution?.prescribable,
          vmpId: resolution?.vmpId,
          ukFormularyName: resolution?.ukFormularyName,
          rag: resolution?.rag,
          via: toVia(resolution?.via ?? 'unresolved'),
          unresolved: resolution?.unresolved ?? true,
        },
      })
    }

    return { mapped, unresolved }
  },
})
