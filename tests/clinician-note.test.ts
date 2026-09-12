import { describe, expect, it, vi } from 'vitest'
import type { MutationCtx } from '../convex/_generated/server'
import type { Id, TableNames } from '../convex/_generated/dataModel'
import type { Rule } from '../rules/types'

/**
 * `recommendations.clinicianNote` survives a rule-pack re-run.
 *
 * `convex/rules.ts` patches a re-emitted row with the engine's fields only, and
 * `ctx.db.patch` merges rather than replaces, so a note the clinician wrote is
 * preserved. That safety is incidental rather than designed: a refactor of the
 * update branch to a replace, or a rule that starts emitting the field, would
 * eat clinician input silently, with a passing deploy and no error anywhere.
 * This test is the only thing standing against that.
 *
 * `convex-test` is not a dependency of this repo, so the database is faked here
 * rather than run in memory. The fake is deliberately thin: the only Convex
 * semantics it reproduces are the ones the claim rests on, and patch's merge is
 * the load-bearing one.
 */

/**
 * A pack of one, so this file tests `convex/rules.ts`'s reconciliation and
 * nothing about which rules ship. The shipped pack changes with the guidance;
 * the guarantee below does not, and a test that read the real pack would fail
 * for reasons that have nothing to do with it.
 */
vi.mock('../rules', () => {
  const rule: Rule = {
    id: 'test-record-condition',
    kind: 'problem',
    target: 'gp',
    countries: 'all',
    reads: 'Every condition on the profile.',
    citations: [{ url: 'https://example.invalid/guidance', quote: 'A quote, so the rule type is satisfied.' }],
    evaluate: (profile) =>
      profile.conditions.map((fact) => ({
        kind: 'recommendation',
        outputKey: `test-record-condition:${fact.key}`,
        title: fact.resolved ?? fact.verbatim,
        rationale: `The records give this as ${fact.verbatim}.`,
        consumed: [fact],
      })),
  }
  return { pack: [rule] }
})

const { applyRules } = await import('../convex/rules')
const { setNote } = await import('../convex/review')

interface FakeDoc {
  _id: string
  _creationTime: number
  [field: string]: unknown
}

/** An id carries its own table, so `get` needs no registry. */
function tableOf(id: string): string {
  return id.slice(0, id.indexOf('|'))
}

class FakeDb {
  private readonly docs = new Map<string, FakeDoc>()
  private sequence = 0

  rows(table: TableNames): FakeDoc[] {
    return [...this.docs.values()].filter((doc) => tableOf(doc._id) === table)
  }

  insert(table: string, fields: Record<string, unknown>): string {
    const _id = `${table}|${++this.sequence}`
    this.docs.set(_id, { _id, _creationTime: Date.now(), ...fields })
    return _id
  }

  /** Both call shapes: `get(id)` as convex/rules.ts uses it, `get(table, id)` as convex/review.ts does. */
  get(...args: [string] | [string, string]): FakeDoc | null {
    const id = args.length === 2 ? args[1] : args[0]
    return this.docs.get(id) ?? null
  }

  /**
   * Merges, and removes a field set to undefined. This is the behaviour the
   * whole test is about: anything not named in `fields` is left alone.
   */
  patch(...args: [string, Record<string, unknown>] | [string, string, Record<string, unknown>]): void {
    const [id, fields] = args.length === 3 ? [args[1], args[2]] : [args[0], args[1]]
    const existing = this.docs.get(id as string)
    if (!existing) throw new Error(`patch: no document ${String(id)}`)
    const merged: FakeDoc = { ...existing, ...(fields as Record<string, unknown>) }
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (value === undefined) delete merged[field]
    }
    this.docs.set(existing._id, merged)
  }

  delete(...args: [string] | [string, string]): void {
    this.docs.delete(args.length === 2 ? args[1] : args[0])
  }

  /** `by_patient` is the only index the code under test queries, and `eq` its only bound. */
  query(table: string) {
    const rows = () => this.rows(table as TableNames)
    return {
      withIndex(_name: string, bound: (q: { eq: (field: string, value: unknown) => unknown }) => unknown) {
        const constraints: Array<[string, unknown]> = []
        const builder = {
          eq: (field: string, value: unknown) => {
            constraints.push([field, value])
            return builder
          },
        }
        bound(builder)
        const matching = () =>
          rows().filter((doc) => constraints.every(([field, value]) => doc[field] === value))
        return {
          collect: async () => matching(),
          take: async (limit: number) => matching().slice(0, limit),
        }
      },
    }
  }
}

/**
 * The registered function's underlying handler. Convex warns when a registered
 * function is called directly and exposes `_handler` for exactly this, which is
 * what `convex-test` would be doing under the covers if it were installed.
 */
function handlerOf<Args, Returns>(registered: unknown): (ctx: MutationCtx, args: Args) => Promise<Returns> {
  return (registered as { _handler: (ctx: MutationCtx, args: Args) => Promise<Returns> })._handler
}

const runRules = handlerOf<
  { patientId: Id<'patients'>; asOf: string },
  { recommendations: number; gaps: number; removed: number }
>(applyRules)
const runSetNote = handlerOf<{ recommendationId: Id<'recommendations'>; note: string }, null>(setNote)

const ASOF = '2026-09-12'

/** One patient with one document-evidenced condition, which is all the stub rule reads. */
function seed(): { ctx: MutationCtx; db: FakeDb; patientId: Id<'patients'> } {
  const db = new FakeDb()
  const patientId = db.insert('patients', {
    simId: 'SIM-000001',
    name: 'Test Patient',
    birthDate: '1974-04-01',
    country: 'BD',
    stage: 'applying-rules',
    truth: {
      conditions: ['Type 2 diabetes mellitus'],
      medications: [],
      allergies: [],
      immunisations: [],
    },
  })
  const documentId = db.insert('documents', {
    patientId,
    kind: 'discharge-summary',
    language: 'bn',
    country: 'BD',
    text: 'ডায়াবেটিস মেলিটাস টাইপ ২',
  })
  db.insert('claims', {
    patientId,
    kind: 'condition',
    verbatim: 'ডায়াবেটিস মেলিটাস টাইপ ২',
    resolved: 'Type 2 diabetes mellitus',
    confidence: 'document-evidenced',
    source: {
      kind: 'document',
      id: documentId,
      quote: 'ডায়াবেটিস মেলিটাস টাইপ ২',
      verified: true,
    },
  })

  return { ctx: { db } as unknown as MutationCtx, db, patientId: patientId as Id<'patients'> }
}

/** The row the stub rule writes, which is the one a clinician annotates. */
function conditionRow(db: FakeDb): FakeDoc {
  const rows = db.rows('recommendations').filter((row) => row.ruleId === 'test-record-condition')
  expect(rows).toHaveLength(1)
  return rows[0]
}

describe('a clinician note across a rule-pack re-run', () => {
  it('survives, with the engine fields refreshed around it', async () => {
    const { ctx, db, patientId } = seed()

    await runRules(ctx, { patientId, asOf: ASOF })
    const before = conditionRow(db)
    await runSetNote(ctx, {
      recommendationId: before._id as Id<'recommendations'>,
      note: '  Patient stable on metformin, confirmed on the call.  ',
    })
    expect(conditionRow(db).clinicianNote).toBe('Patient stable on metformin, confirmed on the call.')

    // The whole pack re-runs after a call, per #18. This is that second run.
    await runRules(ctx, { patientId, asOf: ASOF })

    const after = conditionRow(db)
    // Updated in place, not deleted and reinserted: a new row would carry no note.
    expect(after._id).toBe(before._id)
    expect(after.clinicianNote).toBe('Patient stable on metformin, confirmed on the call.')
    // Still the clinician's to decide, and still carrying what the engine writes.
    expect(after.status).toBe('proposed')
    expect(after.title).toBe('Type 2 diabetes mellitus')
    expect(after.confidence).toBe('document-evidenced')
  })

  /**
   * The complement, and the reason the test above is not tautological: the
   * engine must not be writing the field at all. A rule that started emitting
   * `clinicianNote` would overwrite a note on every re-run, and the assertion
   * above would still pass for as long as the two strings happened to match.
   */
  it('is never a field the engine writes, so patch has nothing to overwrite it with', async () => {
    const { ctx, db, patientId } = seed()
    await runRules(ctx, { patientId, asOf: ASOF })

    for (const row of db.rows('recommendations')) {
      expect(Object.keys(row)).not.toContain('clinicianNote')
    }
  })
})

describe('review.setNote', () => {
  it('clears the field on an empty note rather than storing an empty string', async () => {
    const { ctx, db, patientId } = seed()
    await runRules(ctx, { patientId, asOf: ASOF })
    const recommendationId = conditionRow(db)._id as Id<'recommendations'>

    await runSetNote(ctx, { recommendationId, note: 'Check the dose.' })
    await runSetNote(ctx, { recommendationId, note: '   ' })

    expect(Object.keys(conditionRow(db))).not.toContain('clinicianNote')
  })

  /** A note on a row already written back describes a resource the sim holds unchanged. */
  it('refuses a row that is no longer proposed', async () => {
    const { ctx, db, patientId } = seed()
    await runRules(ctx, { patientId, asOf: ASOF })
    const recommendationId = conditionRow(db)._id as Id<'recommendations'>
    db.patch(recommendationId, { status: 'approved' })

    await runSetNote(ctx, { recommendationId, note: 'Too late.' })

    expect(Object.keys(conditionRow(db))).not.toContain('clinicianNote')
  })
})
