import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { matchRecovery, recoveryDetail } from './lib/matchRecovery'

const metric = v.object({ total: v.number(), recovered: v.number() })

/** Computed live from `claims` against the frozen `truth` snapshot. Never reads `patients.recovery`. */
export const forPatient = query({
  args: { patientId: v.id('patients') },
  returns: metric,
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get('patients', patientId)
    if (!patient) throw new Error(`Patient ${patientId} not found`)

    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(1000)

    return matchRecovery(patient.truth, claims)
  },
})

/**
 * Every fact the simulator holds, each marked recovered or missed. Drives the
 * recovery sheet, where a bare count cannot say what the pipeline lost.
 */
export const detailForPatient = query({
  args: { patientId: v.id('patients') },
  returns: v.object({
    total: v.number(),
    recovered: v.number(),
    facts: v.array(
      v.object({
        kind: v.union(v.literal('condition'), v.literal('medication'), v.literal('allergy')),
        fact: v.string(),
        recovered: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get('patients', patientId)
    if (!patient) throw new Error(`Patient ${patientId} not found`)

    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(1000)

    return recoveryDetail(patient.truth, claims)
  },
})

/** Batches `forPatient` over several patients, for the board's recovery column. */
export const forPatients = query({
  args: { patientIds: v.array(v.id('patients')) },
  returns: v.array(v.object({ patientId: v.id('patients'), total: v.number(), recovered: v.number() })),
  handler: async (ctx, { patientIds }) => {
    const results: { patientId: Id<'patients'>; total: number; recovered: number }[] = []

    for (const patientId of patientIds) {
      const patient = await ctx.db.get('patients', patientId)
      if (!patient) continue

      const claims = await ctx.db
        .query('claims')
        .withIndex('by_patient', (q) => q.eq('patientId', patientId))
        .take(1000)

      results.push({ patientId, ...matchRecovery(patient.truth, claims) })
    }

    return results
  },
})
