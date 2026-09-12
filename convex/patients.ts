import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { viewPatient } from './lib/simClient'
import { normalisePatient, sexFromNarrative } from './lib/normalisePatient'
import { bucketFor } from './lib/confidence'
import type { SexFromText } from './lib/sexFromText'
import { sourceForCountry } from '../src/lib/sources'
import type { PatientSex } from '../src/types'
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

/**
 * `patients.sex` as stored, from a pronoun in the simulator's narrative.
 *
 * `sim-record` is the honest source kind: the sentence came from the sim's own
 * record rather than from a PresentedDocument, and it is the kind
 * convex/lib/confidence.ts already grades `document-evidenced`, so no bucket
 * is decided here. No `verified`, because ADR 17 anchors a quote against a
 * document and there is no document to anchor against. No `synthesised`,
 * because nothing was invented: this is the sim's own prose, quoted. See ADR
 * 20.
 */
function storedSex(simId: string, read: SexFromText): PatientSex {
  return {
    value: read.value,
    confidence: bucketFor({ sourceKind: 'sim-record' }),
    source: { kind: 'sim-record', id: simId, quote: read.quote },
  }
}

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
    /** Already optional on the schema, so a caller that read no pronoun omits it. */
    sex: patientDoc.fields.sex,
  },
  returns: v.id('patients'),
  handler: async (ctx, { simId, name, birthDate, country, truth, degradation, sex }) => {
    const existing = await ctx.db
      .query('patients')
      .withIndex('by_simId', (q) => q.eq('simId', simId))
      .unique()

    if (existing) {
      /**
       * Sex gets the same care as `truth`, for a different reason. ADR 11
       * freezes `truth` because it is the answer key. Sex is not scored, but a
       * value that came from a call is the patient's own statement, and a
       * value read off the record is a pronoun someone else wrote in prose.
       * The statement outranks the pronoun, so a re-onboard never overwrites a
       * `transcript` source. See ADR 20.
       */
      const settledOnACall = existing.sex?.source.kind === 'transcript'
      await ctx.db.patch('patients', existing._id, {
        name,
        birthDate,
        country,
        ...(degradation ? { degradation } : {}),
        ...(sex && !settledOnACall ? { sex } : {}),
      })
      return existing._id
    }

    return await ctx.db.insert('patients', { simId, name, birthDate, country, truth, degradation, sex, stage: 'degrading' })
  },
})

/**
 * Snapshots a simulator patient into `patients` as the frozen answer key.
 * Onboarding the same sim patient twice updates that row rather than
 * creating a duplicate: two developers share one Convex dev deployment, so
 * accidental double-onboarding happens. The already-onboarded row's truth
 * is left untouched, since ADR 11 freezes it at first onboarding; only the
 * identity fields refresh, and `sex` is filled in where the row has none.
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
      /**
       * A row onboarded before ADR 20 carries no sex, and re-onboarding is how
       * it gets one. The view is re-read for that case only: it is an HTTP
       * round trip per page, and a row that already holds a sex, off the
       * record or off a call, needs nothing from it.
       */
      const narrative = existing.sex ? undefined : sexFromNarrative(await viewPatient(patientId))
      return await ctx.runMutation(internal.patients.upsert, {
        simId: patientId,
        name,
        birthDate,
        country: upperCountry,
        truth: existing.truth,
        degradation,
        ...(narrative ? { sex: storedSex(patientId, narrative) } : {}),
      })
    }

    const resources = await viewPatient(patientId)
    const record = normalisePatient({
      patient: { id: patientId, name, birthDate, localIds: {}, conditions: [], needs: [], goals: [] },
      resources,
    })
    const sexRead = sexFromNarrative(resources)

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
      /**
       * Read here rather than in extraction, because the pronoun is in the sim
       * view this action already has in hand and never reaches a
       * PresentedDocument: the degrader assembles documents from `truth`,
       * which holds no prose. Absent where the sim wrote no pronoun for this
       * patient, or wrote both, and then the sex rule asks on the call
       * instead. See ADR 20.
       */
      ...(sexRead ? { sex: storedSex(record.id, sexRead) } : {}),
    })
  },
})
