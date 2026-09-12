import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { viewPatient } from './lib/simClient'
import { normalisePatient } from './lib/normalisePatient'
import { sourceForCountry } from '../src/lib/sources'
import schema from './schema'

const truth = v.object({
  conditions: v.array(v.string()),
  medications: v.array(v.string()),
  allergies: v.array(v.string()),
  immunisations: v.array(v.string()),
})

/**
 * Derived from the schema rather than restated, so a column added to
 * `patients` cannot leave this query rejecting its own rows.
 */
const patientDoc = schema.doc('patients')

/** Drives the board. Reactive: a client subscribed to this sees stage changes without a refresh. */
export const list = query({
  args: {},
  returns: v.array(patientDoc),
  handler: async (ctx) => await ctx.db.query('patients').order('desc').take(200),
})

/** One patient by Convex id, for the patient page. */
export const get = query({
  args: { patientId: v.id('patients') },
  returns: v.union(v.null(), patientDoc),
  handler: async (ctx, { patientId }) => await ctx.db.get(patientId),
})

export const getBySimId = internalQuery({
  args: { simId: v.string() },
  returns: v.union(v.null(), patientDoc),
  handler: async (ctx, { simId }) =>
    await ctx.db
      .query('patients')
      .withIndex('by_simId', (q) => q.eq('simId', simId))
      .unique(),
})

/** Looks up a candidate's onboarding status by sim id, for the selection UI. */
export const bySimId = query({
  args: { simId: v.string() },
  returns: v.union(v.null(), patientDoc),
  handler: async (ctx, { simId }) =>
    await ctx.db
      .query('patients')
      .withIndex('by_simId', (q) => q.eq('simId', simId))
      .unique(),
})

/**
 * Inserts or updates the row for one sim patient, keyed on `simId`. The read
 * and the write happen in one transaction, so two onboard calls racing on the
 * same new patient cannot create two rows.
 */
export const upsert = internalMutation({
  args: {
    simId: v.string(),
    name: v.string(),
    birthDate: v.string(),
    country: v.string(),
    truth,
    degradation: v.optional(v.object({ severity: v.number(), translate: v.boolean() })),
  },
  returns: v.id('patients'),
  handler: async (ctx, { simId, name, birthDate, country, truth, degradation }) => {
    const existing = await ctx.db
      .query('patients')
      .withIndex('by_simId', (q) => q.eq('simId', simId))
      .unique()

    if (existing) {
      await ctx.db.patch('patients', existing._id, { name, birthDate, country, ...(degradation ? { degradation } : {}) })
      return existing._id
    }

    return await ctx.db.insert('patients', { simId, name, birthDate, country, truth, degradation, stage: 'degrading' })
  },
})

/**
 * Snapshots a simulator patient into `patients` as the frozen answer key.
 * Onboarding the same sim patient twice updates that row rather than
 * creating a duplicate: two developers share one Convex dev deployment, so
 * accidental double-onboarding happens. The already-onboarded row's truth
 * is left untouched, since ADR 11 freezes it at first onboarding; only the
 * identity fields refresh.
 */
export const onboard = action({
  args: {
    patientId: v.string(),
    name: v.string(),
    birthDate: v.string(),
    country: v.string(),
    degradation: v.optional(v.object({ severity: v.number(), translate: v.boolean() })),
  },
  returns: v.id('patients'),
  handler: async (ctx, { patientId, name, birthDate, country, degradation }): Promise<Id<'patients'>> => {
    if (!sourceForCountry(country)) {
      throw new Error(`Country ${country} has no matching brand dataset`)
    }

    const upperCountry = country.toUpperCase()

    const existing: Doc<'patients'> | null = await ctx.runQuery(internal.patients.getBySimId, {
      simId: patientId,
    })
    if (existing) {
      return await ctx.runMutation(internal.patients.upsert, {
        simId: patientId,
        name,
        birthDate,
        country: upperCountry,
        truth: existing.truth,
        degradation,
      })
    }

    const resources = await viewPatient(patientId)
    const record = normalisePatient({
      patient: { id: patientId, name, birthDate, localIds: {}, conditions: [], needs: [], goals: [] },
      resources,
    })

    return await ctx.runMutation(internal.patients.upsert, {
      simId: record.id,
      name: record.name,
      birthDate: record.birthDate,
      country: upperCountry,
      truth: {
        conditions: record.conditions,
        medications: record.medications,
        allergies: record.allergies,
        immunisations: record.immunisations,
      },
      degradation,
    })
  },
})
