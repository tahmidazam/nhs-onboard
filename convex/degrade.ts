import { v } from 'convex/values'
import { action, internalMutation, internalQuery, query } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { degradeRecord } from './lib/degradeRecord'
import { applyBrandNames } from './lib/degradeBrand'
import { translateLines } from './lib/degradeTranslate'
import { DEFAULT_SEVERITY, scaleLoss } from './lib/degradeConstants'
import { synthesiseVaccinationCard } from './lib/degradeVaccination'
import { sourceForCountry } from '../src/lib/sources'
import type { PatientRecord } from '../src/types'
import schema from './schema'

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

/** Derived from the schema, so a new document column cannot break this query. */
const documentDoc = schema.doc('documents')

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
      degradation: v.optional(v.object({ severity: v.number(), translate: v.boolean() })),
      /**
       * The value only, not the whole `patients.sex` object: the degrader
       * needs a pronoun and has no use for the provenance. Absent where the
       * sim wrote no pronoun for this patient, and then the letter carries
       * none either. See ADR 20.
       */
      sex: v.optional(v.union(v.literal('male'), v.literal('female'))),
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
      degradation: patient.degradation,
      sex: patient.sex?.value,
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
  args: {
    patientId: v.id('patients'),
    force: v.optional(v.boolean()),
    /** Overrides what onboarding stored, for a regeneration at a different setting. */
    severity: v.optional(v.number()),
    translate: v.optional(v.boolean()),
  },
  returns: v.array(documentDoc),
  handler: async (ctx, { patientId, force, severity, translate }): Promise<Doc<'documents'>[]> => {
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

    const effectiveSeverity = severity ?? patient.degradation?.severity ?? DEFAULT_SEVERITY
    const effectiveTranslate = translate ?? patient.degradation?.translate ?? true

    /**
     * Seeded from the sim id, so the same patient degrades identically every
     * run. `sex` changes the wording of the clinic letter and nothing else: it
     * consumes no draw, so passing it moved no existing patient's document.
     * ADR 20 established it at onboarding from the sim's own narrative, which
     * is why a letter about Fatima Begum says "she" and never disagrees with
     * the name above it.
     */
    const { documents } = degradeRecord(
      record,
      patient.country,
      patient.simId,
      scaleLoss(effectiveSeverity),
      patient.sex,
    )

    /**
     * The sim carries no immunisation data (ADR 8), so every onboarded patient
     * gets a synthesised card rather than immunisation catch-up depending on
     * which patient a judge happened to pick.
     */
    const vaccinationCard = synthesiseVaccinationCard(
      patient.name,
      patient.birthDate,
      patient.country,
      patient.simId,
      Date.now(),
    )

    const allDocuments = [...documents.map((d) => ({ ...d, synthesised: false as const })), vaccinationCard]

    /**
     * The country's primary language. Falls back to English when the source
     * carries none, and when the operator turned translation off: the text
     * really is English then, and `language` is what the reader is told.
     */
    const language = effectiveTranslate ? (sourceForCountry(patient.country)?.languages[0] ?? 'en') : 'en'

    const drafts = await Promise.all(
      allDocuments.map(async ({ kind, country, text, synthesised, ...rest }) => {
        let lines = text.split('\n')
        const medicationNames = 'medicationNames' in rest ? rest.medicationNames : undefined

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

        return { kind, language, country, text: lines.join('\n'), synthesised }
      }),
    )

    await ctx.runMutation(internal.degrade.replaceDocuments, { patientId, documents: drafts })
    return await ctx.runQuery(internal.degrade.existingDocuments, { patientId })
  },
})

