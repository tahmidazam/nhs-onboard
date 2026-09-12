import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { pack } from '../rules'
import { applyRules as runPack } from '../rules/engine'
import { buildProfile } from '../rules/profile'
import type { Claim, PipelineStage } from '../src/types'

/**
 * Runs the rule pack over one patient and writes what it emits.
 *
 * Thin on purpose, the pattern #6 sets: the pure pack takes data and returns
 * data, and this only reads, writes and advances the stage. Every clinical
 * decision and every citation lives in `rules/`, which imports nothing from
 * Convex and performs no IO.
 *
 * See docs/adr/0013-rules-are-typed-typescript-modules.md and
 * docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

/**
 * The one stage this step owns. Past `applying-rules`, and no further: whether a
 * call happens, and so the move on to `ready-for-review`, is the orchestrator's
 * branch. See ADR 4 and #27.
 */
const NEXT_STAGE = 'awaiting-call' as const

/**
 * Stage order, so a re-run can tell forwards from backwards. A Record rather
 * than an array, so a stage added to the shared contract fails to compile here
 * until someone places it.
 */
const STAGE_ORDER: Record<PipelineStage, number> = {
  'not-onboarded': 0,
  degrading: 1,
  'documents-ready': 2,
  extracting: 3,
  mapping: 4,
  'applying-rules': 5,
  'awaiting-call': 6,
  'ready-for-review': 7,
  actioned: 8,
}

/** The stored row as the pure builder wants it. Field for field, no derivation. */
function toClaim(doc: Doc<'claims'>): Claim {
  return {
    id: doc._id,
    patientId: doc.patientId,
    kind: doc.kind,
    verbatim: doc.verbatim,
    resolved: doc.resolved,
    confidence: doc.confidence,
    source: doc.source,
    mapping: doc.mapping,
  }
}

/**
 * Country of origin lands on `patients` with #6. Until then the degrader's stamp
 * on the documents is the only place it lives, and every document for a patient
 * carries the same code. Empty when the patient has no documents yet, which
 * gates the country-keyed rule off rather than guessing a country. See ADR 9.
 */
function countryOf(documents: readonly Doc<'documents'>[]): string {
  return documents.find((doc) => doc.country)?.country ?? ''
}

interface Keyed {
  outputKey?: string
}

/**
 * Which existing rows a re-run may touch, given the keys this run emitted.
 *
 * The whole pack re-runs, never part of it, because an answer to one question
 * legitimately changes what another rule should say. So the row set has to be
 * reconciled rather than appended to, and `outputKey` is what makes that
 * possible: a row whose key is still emitted is updated in place, a `proposed`
 * or `open` row whose key is gone is deleted, and a row the clinician or the
 * patient has already decided is never touched in either direction. A decided
 * row still claims its key, so its decision is not shadowed by a fresh row
 * beside it. See #18.
 */
function planRows<Row extends Keyed>(
  existing: readonly Row[],
  decided: (row: Row) => boolean,
  emitted: ReadonlySet<string>,
): { update: Array<{ row: Row; key: string }>; remove: Row[]; insert: string[] } {
  const claimed = new Set<string>()
  // Decided rows claim first, so the plan does not depend on the order the rows
  // came back in.
  for (const row of existing) {
    if (row.outputKey !== undefined && decided(row)) claimed.add(row.outputKey)
  }

  const update: Array<{ row: Row; key: string }> = []
  const remove: Row[] = []

  for (const row of existing) {
    const key = row.outputKey
    // No key means no run of the pack wrote this row, so it is not this run's to
    // delete: convex/dev.ts seeds gaps by hand and they outlive a re-run.
    if (key === undefined || decided(row)) continue
    if (emitted.has(key) && !claimed.has(key)) {
      claimed.add(key)
      update.push({ row, key })
    } else {
      remove.push(row)
    }
  }

  return { update, remove, insert: [...emitted].filter((key) => !claimed.has(key)) }
}

/**
 * `asOf` is an argument and never a fetch: the orchestrator reads `/api/clock`
 * and passes it in, so the step is deterministic, testable without a network
 * stub, and quotes the same clock the screen shows. See ADR 11.
 */
export const applyRules = internalMutation({
  args: { patientId: v.id('patients'), asOf: v.string() },
  /** Counts of what the pack emitted, and of the rows the re-run reconciled away. */
  returns: v.object({ recommendations: v.number(), gaps: v.number(), removed: v.number() }),
  handler: async (ctx, { patientId, asOf }) => {
    const patient = await ctx.db.get(patientId)
    if (!patient) throw new Error(`applyRules: no patient ${patientId}`)

    // An unparseable date yields NaN ages, and an age-gated rule then silently
    // never fires rather than failing. The clock is the caller's to supply, so a
    // bad one is a caller bug and belongs on the surface.
    if (Number.isNaN(Date.parse(asOf))) throw new Error(`applyRules: asOf '${asOf}' is not a date`)
    if (Number.isNaN(Date.parse(patient.birthDate))) {
      throw new Error(`applyRules: birthDate '${patient.birthDate}' is not a date`)
    }

    // Bounded by one patient's own record: a handful of documents and tens of
    // claims, not a table scan.
    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    const documents = await ctx.db
      .query('documents')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()

    const profile = buildProfile(
      {
        // The sim id, not ours: this is the id that travels in the age fact's
        // SourceRef, which names a sim record. See ageFact in rules/profile.ts.
        patientId: patient.simId,
        birthDate: patient.birthDate,
        country: countryOf(documents),
        // Only the value. Sex gates a rule and is never consumed by one, so the
        // bucket and the quote stay on the patient row where the header reads
        // them. Absent until onboarding finds a pronoun or a call settles it,
        // which is the case `nhs-establish-sex` exists for. See ADR 20.
        sex: patient.sex?.value,
      },
      claims.map(toClaim),
      asOf,
      // A Claim carries no synthesised flag: it lives on the document, per ADR 8,
      // and the builder performs no IO. So the ids are read here and passed in,
      // and they are `documents._id` because that is what extraction writes into
      // `SourceRef.id`. Get this wrong and ADR 8's label silently comes off
      // every recommendation resting on the generated vaccination card.
      documents.filter((doc) => doc.synthesised).map((doc) => doc._id),
    )

    const emitted = runPack(profile, pack)
    const newRecs = new Map(
      emitted.flatMap((out) => (out.kind === 'recommendation' ? [[out.outputKey, out.rec] as const] : [])),
    )
    const newGaps = new Map(
      emitted.flatMap((out) => (out.kind === 'gap' ? [[out.outputKey, out.gap] as const] : [])),
    )

    const recRows = await ctx.db
      .query('recommendations')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()
    const gapRows = await ctx.db
      .query('gaps')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .collect()

    /** A clinician's decision outranks a re-run. */
    const recPlan = planRows(recRows, (row) => row.status !== 'proposed', new Set(newRecs.keys()))
    for (const { row, key } of recPlan.update) {
      const rec = newRecs.get(key)!
      // `extraCitations` is named rather than spread because a rule that has
      // stopped emitting one has to clear the stale value, and patch removes a
      // field set to undefined. Everything else the engine always writes.
      await ctx.db.patch(row._id, { ...rec, extraCitations: rec.extraCitations })
    }
    for (const row of recPlan.remove) await ctx.db.delete(row._id)
    for (const key of recPlan.insert) {
      await ctx.db.insert('recommendations', { patientId, status: 'proposed', ...newRecs.get(key)! })
    }

    /** An answered gap is the patient's own decision, and outranks a re-run too. */
    const gapPlan = planRows(gapRows, (row) => row.status !== 'open', new Set(newGaps.keys()))
    for (const { row, key } of gapPlan.update) await ctx.db.patch(row._id, newGaps.get(key)!)
    for (const row of gapPlan.remove) await ctx.db.delete(row._id)
    for (const key of gapPlan.insert) {
      await ctx.db.insert('gaps', { patientId, status: 'open', ...newGaps.get(key)! })
    }

    // The rules have run. A re-run after the call must not drag the patient back
    // out of review, so the stage only ever moves forward from here and the
    // branch beyond stays with the orchestrator. See ADR 4 and #27.
    if (STAGE_ORDER[patient.stage] < STAGE_ORDER[NEXT_STAGE]) {
      await ctx.db.patch(patientId, { stage: NEXT_STAGE })
    }

    return {
      recommendations: newRecs.size,
      gaps: newGaps.size,
      removed: recPlan.remove.length + gapPlan.remove.length,
    }
  },
})
