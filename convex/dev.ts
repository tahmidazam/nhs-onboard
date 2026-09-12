import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Seeds one patient and the gaps a call would close, so the voice path can be
 * driven before the sim adapter and the rule pack land. Delete once
 * convex/sim.ts and convex/rules.ts write these rows for real.
 */

const DEMO_SIM_ID = 'demo-bd-1'

/**
 * Phrased as the assistant would ask them. `ruleId` names the rule that would
 * have raised each one, so the seeded set matches the shipped pack.
 */
const DEMO_GAPS = [
  {
    ruleId: 'immunisation-catch-up',
    question: 'Do you have any record of the vaccinations you were given as a child?',
  },
  {
    ruleId: 'measles-dose-validity',
    question: 'Have you ever had a measles vaccination, and do you know how many doses?',
  },
  {
    ruleId: 'hepatitis-b-country-gated',
    question: 'Have you ever been tested for hepatitis B?',
  },
  {
    /** The sim carries no sex, and cervical, breast and AAA screening are gated on it. */
    ruleId: 'screening-sex-unknown',
    question:
      'The records we received do not say which sex the practice should record for screening. Which should we use?',
  },
] as const

export const seedDemoPatient = mutation({
  args: {},
  returns: v.object({ patientId: v.id('patients'), gaps: v.number() }),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query('patients')
      .withIndex('by_simId', (q) => q.eq('simId', DEMO_SIM_ID))
      .first()

    /** Re-running replaces the gaps rather than stacking a second set. */
    if (existing) {
      const old = await ctx.db
        .query('gaps')
        .withIndex('by_patient', (q) => q.eq('patientId', existing._id))
        .collect()
      for (const gap of old) await ctx.db.delete(gap._id)
      await insertGaps(ctx, existing._id)
      return { patientId: existing._id, gaps: DEMO_GAPS.length }
    }

    const patientId = await ctx.db.insert('patients', {
      simId: DEMO_SIM_ID,
      name: 'Rahim Uddin',
      birthDate: '1968-04-11',
      stage: 'awaiting-call',
      truth: {
        conditions: ['Type 2 diabetes mellitus', 'Hypertension'],
        medications: ['Metformin', 'Amlodipine'],
        allergies: [],
        immunisations: ['BCG', 'Measles'],
      },
    })

    await insertGaps(ctx, patientId)
    return { patientId, gaps: DEMO_GAPS.length }
  },
})

async function insertGaps(
  ctx: { db: { insert: (table: 'gaps', doc: Omit<Doc<'gaps'>, '_id' | '_creationTime'>) => Promise<Id<'gaps'>> } },
  patientId: Id<'patients'>,
) {
  for (const gap of DEMO_GAPS) {
    await ctx.db.insert('gaps', {
      patientId,
      question: gap.question,
      ruleId: gap.ruleId,
      status: 'open',
    })
  }
}

/** The patient the placeholder shell calls. Replaced by the board route. */
export const demoPatient = query({
  args: {},
  returns: v.union(v.null(), v.object({ _id: v.id('patients'), name: v.string() })),
  handler: async (ctx) => {
    const patient = await ctx.db
      .query('patients')
      .withIndex('by_simId', (q) => q.eq('simId', DEMO_SIM_ID))
      .first()
    return patient ? { _id: patient._id, name: patient.name } : null
  },
})
