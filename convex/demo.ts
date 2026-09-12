import { v } from 'convex/values'
import { api, internal } from './_generated/api'
import { action, internalMutation } from './_generated/server'
import type { ActionCtx, MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { DEMO_COHORT, type DemoCohortEntry } from './lib/demoCohort'

/**
 * Seeds and clears the committed demo cohort, so the clinician screen opens
 * onto a populated list on demo day. The cohort itself, and why each patient is
 * in it, lives in convex/lib/demoCohort.ts. It is a convenience and not a
 * curated shortlist: the patient finder still rolls and searches across the
 * whole population, which is what ADR 12 actually requires.
 *
 * Both entry points are actions, because `patients.onboard` and `pipeline.run`
 * are actions and only an action can call one.
 */

/** What happened to one cohort entry. Returned per patient, never aggregated away. */
const seedResult = v.object({
  simId: v.string(),
  /** As the sim reports it now, not as convex/lib/demoCohort.ts remembers it. */
  name: v.optional(v.string()),
  patientId: v.optional(v.id('patients')),
  outcome: v.union(
    /** Onboarded and taken to `ready-for-review`. */
    v.literal('pipelined'),
    /** Onboarded, but the pipeline threw. The row is on the board mid-stage. */
    v.literal('onboarded'),
    /** The sim does not hold this id, so nothing was written. */
    v.literal('not-in-sim'),
    v.literal('failed'),
  ),
  error: v.optional(v.string()),
})

interface SeedResult {
  simId: string
  name?: string
  patientId?: Id<'patients'>
  outcome: 'pipelined' | 'onboarded' | 'not-in-sim' | 'failed'
  error?: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The cohort, or the subset a caller named. Unknown ids are reported, not skipped silently. */
function selected(simIds: string[] | undefined): DemoCohortEntry[] {
  if (!simIds) return DEMO_COHORT
  return DEMO_COHORT.filter((entry) => simIds.includes(entry.simId))
}

/**
 * Identity as the sim holds it right now.
 *
 * `patients.onboard` takes the name and birth date as arguments and writes them
 * into the row, so reading them from the sim rather than from the committed
 * constants is what keeps the board from ever showing a name a constant went
 * stale on. It doubles as the check that a committed id still resolves: a
 * cohort entry the sim cannot find is reported as `not-in-sim` rather than
 * onboarded from stale data.
 */
async function identify(
  ctx: ActionCtx,
  simId: string,
): Promise<{ id: string; name: string; birthDate: string } | null> {
  const { items } = await ctx.runAction(api.sim.search, { q: simId, offset: 0 })
  return items.find((item) => item.id === simId) ?? null
}

/**
 * Onboards each cohort entry and runs the pipeline on it, one patient at a
 * time.
 *
 * Sequential on purpose, and the fan-out would be the obvious mistake here.
 * One patient costs four extraction agents per document, and a translated one
 * costs a translation call per document on top. Each patient already fans out
 * across their own documents, so six patients at once is that burst multiplied
 * by six, and OpenAI answers a burst like that with rate limits rather than
 * results. Going one at a time costs wall-clock time nobody is watching,
 * because this runs before the judges arrive.
 *
 * Idempotent. `patients.upsert` is keyed on `simId` and ADR 11 freezes `truth`
 * at first onboarding, so re-running refreshes the identity fields and the
 * degradation dial and never adds a second row. `degrade` reuses documents that
 * already exist unless forced, extraction clears its own previous run, and
 * `rules.planRows` reconciles rather than duplicates, so a second run over a
 * seeded cohort is cheap and leaves one set of rows.
 *
 * A failure on one patient is caught and recorded against that patient, so the
 * other five still get seeded. Reseeding after a fix re-runs only what the
 * caller asks for, via `simIds`.
 */
export const seedCohort = action({
  args: {
    /** A subset of the cohort, for seeding one patient rather than paying for six. */
    simIds: v.optional(v.array(v.string())),
  },
  returns: v.array(seedResult),
  handler: async (ctx: ActionCtx, { simIds }): Promise<SeedResult[]> => {
    const results: SeedResult[] = []

    for (const entry of selected(simIds)) {
      const patient = await identify(ctx, entry.simId)
      if (!patient) {
        results.push({ simId: entry.simId, outcome: 'not-in-sim' })
        continue
      }

      /**
       * A row already on the board, degraded at somebody else's dial, is the
       * one case where re-running is not enough on its own. `degrade` reuses
       * documents that exist unless forced, and `extract.run` skips outright
       * once document claims are stored, so a patient onboarded by hand at
       * severity 0.5 would keep those documents and those claims while the row
       * claims the cohort's severity. Read the dial before `onboard` overwrites
       * it, and regenerate below where it disagrees.
       */
      const existing: Doc<'patients'> | null = await ctx.runQuery(internal.patients.getBySimId, {
        simId: entry.simId,
      })
      const staleDial =
        existing !== null &&
        (existing.degradation?.severity !== entry.severity ||
          existing.degradation?.translate !== entry.translate)

      let patientId: Id<'patients'>
      try {
        patientId = await ctx.runAction(api.patients.onboard, {
          patientId: patient.id,
          name: patient.name,
          birthDate: patient.birthDate,
          country: entry.country,
          degradation: { severity: entry.severity, translate: entry.translate },
        })
      } catch (error) {
        results.push({ simId: entry.simId, name: patient.name, outcome: 'failed', error: message(error) })
        continue
      }

      try {
        if (staleDial) {
          /**
           * `reExtract` and not `run`, because the forced re-degrade deleted
           * the documents the stored claims cite, and a claim whose SourceRef
           * points at a document that no longer exists is exactly the
           * unevidenced row ADR 17 refuses to keep. It clears the
           * document-sourced claims and leaves anything a call produced.
           */
          await ctx.runAction(api.degrade.degrade, { patientId, force: true })
          await ctx.runAction(api.extract.reExtract, { patientId })
        }

        await ctx.runAction(api.pipeline.run, { patientId })
        results.push({ simId: entry.simId, name: patient.name, patientId, outcome: 'pipelined' })
      } catch (error) {
        /**
         * The row exists and holds its frozen `truth`, so the patient is on the
         * board at whatever stage the pipeline reached. Reported separately
         * from `failed` because the two want different actions: this one is
         * re-runnable from the patient page, that one is not on the board at
         * all.
         */
        results.push({
          simId: entry.simId,
          name: patient.name,
          patientId,
          outcome: 'onboarded',
          error: message(error),
        })
      }
    }

    return results
  },
})


/* -------------------------------------------------------------------------- */
/* Clearing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One table's worth of rows, capped.
 *
 * 50 rather than everything, because `agentRuns` holds the document text as
 * sent, clipped at 24k characters, so sixteen of those rows per patient is most
 * of a megabyte and a mutation's read and write budget is finite. One table per
 * transaction keeps the worst case to 50 rows of the largest table.
 */
const CLEAR_BATCH = 50

const clearedTable = v.union(
  v.literal('documents'),
  v.literal('claims'),
  v.literal('agentRuns'),
  v.literal('gaps'),
  v.literal('recommendations'),
  v.literal('calls'),
  v.literal('patients'),
)

type ClearedTable =
  | 'documents'
  | 'claims'
  | 'agentRuns'
  | 'gaps'
  | 'recommendations'
  | 'calls'
  | 'patients'

/** Rows removed per table. Reported rather than summed, because a reset is destructive. */
const tableCounts = v.object({
  documents: v.number(),
  claims: v.number(),
  agentRuns: v.number(),
  gaps: v.number(),
  recommendations: v.number(),
  calls: v.number(),
  patients: v.number(),
})

type TableCounts = Record<ClearedTable, number>

function noCounts(): TableCounts {
  return { documents: 0, claims: 0, agentRuns: 0, gaps: 0, recommendations: 0, calls: 0, patients: 0 }
}

interface Cleared {
  table: ClearedTable
  deleted: number
}

const batchResult = v.object({
  /** Absent on the pass that found nothing left to delete. */
  table: v.optional(clearedTable),
  deleted: v.number(),
  done: v.boolean(),
})

/**
 * Every table that hangs off a patient by `patientId`, each with a
 * `by_patient` index, in the order a reset empties them. Listed rather than
 * derived, so adding a table to the schema is a deliberate decision about
 * whether a reset should clear it.
 *
 * Written out one closure per table rather than through a generic helper over a
 * union of table names. The table name has to reach `ctx.db.query` as a
 * literal: a generic parameter leaves the `by_patient` index field a union
 * across every table in the schema, which `q.eq('patientId', ...)` then cannot
 * satisfy, and `ctx.db.delete` loses which table the id belongs to. The
 * repetition is what keeps both typed.
 */
const CHILD_CLEARERS: ((ctx: MutationCtx, patientId: Id<'patients'>) => Promise<Cleared>)[] = [
  async (ctx, patientId) => {
    const rows = await ctx.db
      .query('documents')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('documents', row._id)
    return { table: 'documents', deleted: rows.length }
  },
  async (ctx, patientId) => {
    const rows = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('claims', row._id)
    return { table: 'claims', deleted: rows.length }
  },
  async (ctx, patientId) => {
    const rows = await ctx.db
      .query('agentRuns')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('agentRuns', row._id)
    return { table: 'agentRuns', deleted: rows.length }
  },
  async (ctx, patientId) => {
    const rows = await ctx.db
      .query('gaps')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('gaps', row._id)
    return { table: 'gaps', deleted: rows.length }
  },
  async (ctx, patientId) => {
    const rows = await ctx.db
      .query('recommendations')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('recommendations', row._id)
    return { table: 'recommendations', deleted: rows.length }
  },
  async (ctx, patientId) => {
    const rows = await ctx.db
      .query('calls')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('calls', row._id)
    return { table: 'calls', deleted: rows.length }
  },
]

/**
 * The same six tables, unfiltered, for `scope: 'all'`.
 *
 * Not the per-patient clearers in a loop over patients, because a row whose
 * patient is already gone would survive that: a call placed against a patient
 * somebody deleted by hand, and the `agentRuns` that read its transcript, are
 * exactly the residue an unscoped reset exists to remove. Reading the table
 * directly finds them.
 */
const ALL_CLEARERS: ((ctx: MutationCtx) => Promise<Cleared>)[] = [
  async (ctx) => {
    const rows = await ctx.db.query('documents').take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('documents', row._id)
    return { table: 'documents', deleted: rows.length }
  },
  async (ctx) => {
    const rows = await ctx.db.query('claims').take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('claims', row._id)
    return { table: 'claims', deleted: rows.length }
  },
  async (ctx) => {
    const rows = await ctx.db.query('agentRuns').take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('agentRuns', row._id)
    return { table: 'agentRuns', deleted: rows.length }
  },
  async (ctx) => {
    const rows = await ctx.db.query('gaps').take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('gaps', row._id)
    return { table: 'gaps', deleted: rows.length }
  },
  async (ctx) => {
    const rows = await ctx.db.query('recommendations').take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('recommendations', row._id)
    return { table: 'recommendations', deleted: rows.length }
  },
  async (ctx) => {
    const rows = await ctx.db.query('calls').take(CLEAR_BATCH)
    for (const row of rows) await ctx.db.delete('calls', row._id)
    return { table: 'calls', deleted: rows.length }
  },
]

/**
 * Deletes one batch from the first table that still has rows for this patient,
 * and says whether anything is left. The patient row itself goes last, so an
 * interrupted reset leaves a patient with fewer children rather than orphaned
 * children with no patient.
 */
export const clearBatch = internalMutation({
  args: { patientId: v.id('patients') },
  returns: batchResult,
  handler: async (ctx, { patientId }) => {
    for (const clear of CHILD_CLEARERS) {
      const cleared = await clear(ctx, patientId)
      if (cleared.deleted > 0) return { table: cleared.table, deleted: cleared.deleted, done: false }
    }

    const patient = await ctx.db.get('patients', patientId)
    if (!patient) return { deleted: 0, done: true }
    await ctx.db.delete('patients', patientId)
    return { table: 'patients' as const, deleted: 1, done: true }
  },
})

/**
 * The same, over every row in the six child tables and then every patient.
 *
 * Children before patients for the same reason as above, and because it is the
 * order that keeps the board honest while this runs: a patient whose documents
 * and recommendations have gone is a row a clinician can see is being cleared,
 * whereas a recommendation whose patient has gone is a row nothing can render.
 */
export const clearAnyBatch = internalMutation({
  args: {},
  returns: batchResult,
  handler: async (ctx) => {
    for (const clear of ALL_CLEARERS) {
      const cleared = await clear(ctx)
      if (cleared.deleted > 0) return { table: cleared.table, deleted: cleared.deleted, done: false }
    }

    const patients = await ctx.db.query('patients').take(CLEAR_BATCH)
    for (const patient of patients) await ctx.db.delete('patients', patient._id)
    if (patients.length > 0) return { table: 'patients' as const, deleted: patients.length, done: false }

    return { deleted: 0, done: true }
  },
})

const resetPatient = v.object({
  simId: v.string(),
  name: v.optional(v.string()),
  outcome: v.union(
    v.literal('cleared'),
    /** A cohort entry that was not on the board, so there was nothing to clear. */
    v.literal('not-onboarded'),
    /** Still had rows after `MAX_PASSES`. Reset again. */
    v.literal('incomplete'),
  ),
})

interface ResetPatient {
  simId: string
  name?: string
  outcome: 'cleared' | 'not-onboarded' | 'incomplete'
}

interface ResetResult {
  scope: 'cohort' | 'all'
  deleted: TableCounts
  patients: ResetPatient[]
  complete: boolean
}

/**
 * Enough passes to clear anything this pipeline produces, and a stop rather
 * than a loop that cannot end.
 *
 * Per patient, sixteen agent runs, four documents and a few dozen claims, gaps
 * and recommendations sit well inside 50 batches of 50. `scope: 'all'` is
 * bounded by the whole table instead, so it gets a limit that covers a few
 * thousand rows and reports `complete: false` rather than silently stopping
 * short of the end.
 */
const MAX_PASSES = 50
const MAX_PASSES_ALL = 400

/**
 * Clears patients and everything hanging off them, so a demo can be re-run
 * clean between judges.
 *
 * Two scopes, and the default is the narrow one. `cohort` clears the six
 * committed `simId`s and nothing else, because an operator's own patient, found
 * through the finder, is somebody's work in progress. `all` empties the six
 * child tables and the patient table, which is the only thing that removes a
 * half-degraded row or a probe call's residue: `clinic.list` reads every
 * patient in the table with no filter, so anything left behind is on the first
 * screen a judge sees, and no marker column on `patients` exists to tell the
 * cohort from the rest.
 *
 * An action driving a mutation repeatedly, rather than one mutation, because a
 * mutation is a transaction with a read and write budget and `agentRuns` alone
 * can be megabytes per patient. Each pass is its own transaction, and the
 * counts come back per table because this is destructive and a caller should be
 * able to read what went.
 */
export const reset = action({
  args: {
    scope: v.optional(v.union(v.literal('cohort'), v.literal('all'))),
    /** A subset of the cohort. Ignored under `scope: 'all'`, which clears the table. */
    simIds: v.optional(v.array(v.string())),
  },
  returns: v.object({
    scope: v.union(v.literal('cohort'), v.literal('all')),
    deleted: tableCounts,
    patients: v.array(resetPatient),
    /** False where a pass limit was reached with rows still to go. Reset again. */
    complete: v.boolean(),
  }),
  handler: async (ctx: ActionCtx, { scope, simIds }): Promise<ResetResult> => {
    const deleted = noCounts()

    if (scope === 'all') {
      /**
       * Read before deleting, so the return names the patients that went
       * rather than only counting them. `patients.list` takes 200, which is
       * two orders of magnitude more than a demo deployment holds.
       */
      const before: Doc<'patients'>[] = await ctx.runQuery(api.patients.list, {})

      let done = false
      let passes = 0
      for (; passes < MAX_PASSES_ALL && !done; passes += 1) {
        const batch = await ctx.runMutation(internal.demo.clearAnyBatch, {})
        if (batch.table) deleted[batch.table] += batch.deleted
        done = batch.done
      }

      return {
        scope: 'all',
        deleted,
        patients: before.map((patient) => ({
          simId: patient.simId,
          name: patient.name,
          outcome: done ? ('cleared' as const) : ('incomplete' as const),
        })),
        complete: done,
      }
    }

    const patients: ResetPatient[] = []
    let complete = true

    for (const entry of selected(simIds)) {
      const patient: Doc<'patients'> | null = await ctx.runQuery(internal.patients.getBySimId, {
        simId: entry.simId,
      })
      if (!patient) {
        patients.push({ simId: entry.simId, outcome: 'not-onboarded' })
        continue
      }

      let done = false
      for (let pass = 0; pass < MAX_PASSES && !done; pass += 1) {
        const batch = await ctx.runMutation(internal.demo.clearBatch, { patientId: patient._id })
        if (batch.table) deleted[batch.table] += batch.deleted
        done = batch.done
      }

      if (!done) complete = false
      patients.push({
        simId: entry.simId,
        name: patient.name,
        outcome: done ? 'cleared' : 'incomplete',
      })
    }

    return { scope: 'cohort', deleted, patients, complete }
  },
})
