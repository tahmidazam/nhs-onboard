import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { degradeRecord } from './lib/degradeRecord'
import { applyBrandNames } from './lib/degradeBrand'
import { translateLines } from './lib/degradeTranslate'
import { sourceForCountry } from '../src/lib/sources'
import type { PatientRecord } from '../src/types'

/**
 * Turns a patient's frozen snapshot into PresentedDocuments and persists them.
 * The Convex layer stays thin: it reads the patient, calls the pure
 * degrader, runs brand rendering and translation, and writes the result. See
 * docs/adr/0010-degrader-is-template-driven.md.
 */

const documentKind = v.union(
  v.literal('discharge-summary'),
  v.literal('vaccination-card'),
  v.literal('prescription-list'),
  v.literal('clinic-letter'),
)

const documentDoc = v.object({
  _id: v.id('documents'),
  _creationTime: v.number(),
  patientId: v.id('patients'),
  kind: documentKind,
  language: v.string(),
  country: v.string(),
  text: v.string(),
  synthesised: v.optional(v.boolean()),
})

/** A patient's documents, for the patient page. Reactive: updates as they are generated. */
export const list = query({
  args: { patientId: v.id('patients') },
  returns: v.array(documentDoc),
  handler: async (ctx, { patientId }) =>
    await ctx.db
      .query('documents')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect(),
})

export const existingDocuments = internalQuery({
  args: { patientId: v.id('patients') },
  returns: v.array(documentDoc),
  handler: async (ctx, { patientId }) =>
    await ctx.db
      .query('documents')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect(),
})

export const getPatient = internalQuery({
  args: { patientId: v.id('patients') },
  returns: v.union(
    v.null(),
    v.object({
      simId: v.string(),
      name: v.string(),
      birthDate: v.string(),
      country: v.string(),
      truth: v.object({
        conditions: v.array(v.string()),
        medications: v.array(v.string()),
        allergies: v.array(v.string()),
        immunisations: v.array(v.string()),
      }),
    }),
  ),
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get(patientId)
    if (!patient) return null
    return {
      simId: patient.simId,
      name: patient.name,
      birthDate: patient.birthDate,
      country: patient.country,
      truth: patient.truth,
    }
  },
})

/** Clears any existing documents and writes the new set in one transaction. */
export const replaceDocuments = internalMutation({
  args: {
    patientId: v.id('patients'),
    documents: v.array(
      v.object({
        kind: documentKind,
        language: v.string(),
        country: v.string(),
        text: v.string(),
        synthesised: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { patientId, documents }) => {
    const existing = await ctx.db
      .query('documents')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    for (const doc of existing) await ctx.db.delete(doc._id)
    for (const doc of documents) await ctx.db.insert('documents', { patientId, ...doc })
    await ctx.db.patch(patientId, { stage: 'documents-ready' })
    return null
  },
})

/**
 * Degrades a patient's frozen snapshot into documents and persists them.
 * Reruns reuse what is already stored. `force: true` clears and regenerates,
 * which is the only way to re-degrade: see docs/adr/0010-degrader-is-template-driven.md.
 */
export const degrade = action({
  args: { patientId: v.id('patients'), force: v.optional(v.boolean()) },
  returns: v.array(documentDoc),
  handler: async (ctx, { patientId, force }): Promise<Doc<'documents'>[]> => {
    if (!force) {
      const existing = await ctx.runQuery(internal.degrade.existingDocuments, { patientId })
      if (existing.length > 0) return existing
    }

    const patient = await ctx.runQuery(internal.degrade.getPatient, { patientId })
    if (!patient) throw new Error(`Patient ${patientId} not found`)

    const record: PatientRecord = {
      id: patient.simId,
      name: patient.name,
      birthDate: patient.birthDate,
      conditions: patient.truth.conditions,
      medications: patient.truth.medications,
      allergies: patient.truth.allergies,
      immunisations: patient.truth.immunisations,
      raw: null,
    }

    /** Seeded from the sim id, so the same patient degrades identically every run. */
    const { documents } = degradeRecord(record, patient.country, patient.simId)

    /** The country's primary language. Falls back to English when the source carries none. */
    const language = sourceForCountry(patient.country)?.languages[0] ?? 'en'

    const drafts = await Promise.all(
      documents.map(async ({ kind, country, text, medicationNames }) => {
        let lines = text.split('\n')

        /** Brand rendering runs the mapping backwards, before translation. */
        if (medicationNames && medicationNames.length > 0) {
          const brandsByName: Record<string, string> = {}
          for (const name of medicationNames) {
            const brand: string | null = await ctx.runQuery(internal.brands.brandForGeneric, {
              country: patient.country,
              genericName: name,
            })
            if (brand) brandsByName[name] = brand
          }
          lines = applyBrandNames(lines, brandsByName)
        }

        if (language !== 'en') lines = await translateLines(lines, language)

        return { kind, language, country, text: lines.join('\n') }
      }),
    )

    await ctx.runMutation(internal.degrade.replaceDocuments, { patientId, documents: drafts })
    return await ctx.runQuery(internal.degrade.existingDocuments, { patientId })
  },
})

