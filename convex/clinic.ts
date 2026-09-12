import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import type { ClaimKind, Confidence } from '../src/types'
import { matchRecovery } from './lib/matchRecovery'
import { recommendationDoc } from './review'
import schema from './schema'

/**
 * The two clinician screens: the patient list and the SBAR header.
 *
 * Both aggregate, and both do it in one query rather than one query per row.
 * The board learned this the hard way (see convex/board.ts): a list of ten
 * patients that fires ten subscriptions re-renders ten times and reads the
 * same patient row ten times. So a page's worth of patients is read once here
 * and every related table is reached through its `by_patient` index.
 *
 * Shaped for the screen, not for the schema: the counts a band displays are
 * counted here, because a UI that filters a thousand recommendations in the
 * browser to show one number is the same mistake one layer up.
 */

/** Derived from the schema, so a column added to `patients` cannot drift out of these. */
const patientFields = schema.doc('patients').fields
const confidence = schema.doc('claims').fields.confidence

/** Whole documents, per the pattern in convex/patients.ts: the screen reads fields we have not predicted. */
const gapDoc = schema.doc('gaps')

/**
 * Counts of the three buckets ADR 3 fixes, never a number.
 *
 * Camel case rather than the wire values, because a Convex validator key has
 * to be a valid identifier and `document-evidenced` is not: the hyphen is
 * rejected at push time and passes the typecheck. So a row's `confidence` does
 * not index this object directly, and `BUCKET_KEY` below is what keeps the two
 * spellings in step.
 */
const bucketCounts = v.object({
  documentEvidenced: v.number(),
  patientReported: v.number(),
  uncertainMapping: v.number(),
})

export type BucketCounts = { documentEvidenced: number; patientReported: number; uncertainMapping: number }

/** Exhaustive over the union, so a fourth bucket fails the typecheck here. */
const BUCKET_KEY: Record<Confidence, keyof BucketCounts> = {
  'document-evidenced': 'documentEvidenced',
  'patient-reported': 'patientReported',
  'uncertain-mapping': 'uncertainMapping',
}

function countByConfidence(rows: readonly { confidence: Confidence }[]): BucketCounts {
  const counts: BucketCounts = { documentEvidenced: 0, patientReported: 0, uncertainMapping: 0 }
  for (const row of rows) counts[BUCKET_KEY[row.confidence]] += 1
  return counts
}

/**
 * Read caps. Every one of these is bounded by a single patient's own record, so
 * the numbers are headroom rather than pagination: tens of claims and a handful
 * of calls per patient, against a 16,000 document limit per function.
 */
const PATIENT_PAGE = 100
const RECOMMENDATION_CAP = 500
const CLAIM_CAP = 1000
const GAP_CAP = 200
const CALL_CAP = 20

/** True once a call has finished and left something to read. */
function hasCallTranscript(calls: readonly Doc<'calls'>[]): boolean {
  return calls.some((call) => call.status === 'complete' && (call.transcript ?? '') !== '')
}

/**
 * One row per patient for the GP list, with the aggregates the table shows.
 *
 * `sex` travels whole rather than as its value, because the column has to be
 * able to say where it came from: read off a planted pronoun, settled by the
 * call, or absent entirely. See ADR 20.
 */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('patients'),
      name: v.string(),
      birthDate: v.string(),
      country: v.string(),
      sex: patientFields.sex,
      stage: patientFields.stage,
      /** Recommendations still awaiting a decision. The number the row is for. */
      proposedCount: v.number(),
      proposedByConfidence: bucketCounts,
      /** A call has ended and its transcript is in. The list's cue that review can start. */
      callComplete: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const patients = await ctx.db.query('patients').order('desc').take(PATIENT_PAGE)

    const rows = []
    for (const patient of patients) {
      const recommendations = await ctx.db
        .query('recommendations')
        .withIndex('by_patient', (q) => q.eq('patientId', patient._id))
        .take(RECOMMENDATION_CAP)
      const calls = await ctx.db
        .query('calls')
        .withIndex('by_patient', (q) => q.eq('patientId', patient._id))
        .take(CALL_CAP)

      const proposed = recommendations.filter((row) => row.status === 'proposed')

      rows.push({
        _id: patient._id,
        name: patient.name,
        birthDate: patient.birthDate,
        country: patient.country,
        sex: patient.sex,
        stage: patient.stage,
        proposedCount: proposed.length,
        proposedByConfidence: countByConfidence(proposed),
        callComplete: hasCallTranscript(calls),
      })
    }

    return rows
  },
})

/** One line of reconstructed history, as the Background band shows it. */
const backgroundItem = v.object({
  _id: v.id('claims'),
  /** What to display: the resolved UK term where a lookup found one. */
  label: v.string(),
  /** As the foreign record wrote it. Never overwritten, per the Claim contract. */
  verbatim: v.string(),
  /** The dm+d UK ingredient. Medications only, and absent where the brand lookup failed. */
  ingredient: v.optional(v.string()),
  confidence,
  /** Absent where anchoring does not apply: a transcript claim has no quote to verify. ADR 17. */
  verified: v.optional(v.boolean()),
})

function backgroundItems(claims: readonly Doc<'claims'>[], kind: ClaimKind) {
  return claims
    .filter((claim) => claim.kind === kind)
    .map((claim) => {
      // Medications label on the mapped ingredient, never the brand: "Napa" and
      // "Paracetamol" are the same fact and ADR 11 scores it that way, so the
      // header must not name it differently from the metric.
      const ingredient = claim.mapping?.ukIngredient
      return {
        _id: claim._id,
        label: ingredient ?? claim.resolved ?? claim.verbatim,
        verbatim: claim.verbatim,
        ingredient,
        confidence: claim.confidence,
        verified: claim.source.verified,
      }
    })
}

/**
 * The rule that puts allergies to the patient on the call. Named as a string
 * because this query reads a stored `gaps.ruleId` and imports nothing from
 * `rules/`, which is the direction the dependency has always run.
 */
const ALLERGY_GAP_RULE = 'nhs-ask-allergies'

/**
 * The five silos the Recommendation band groups by.
 *
 * `problem` and `allergy` share one, because both land on the record as history
 * rather than as work to do, and a GP reads them as one block.
 */
type Silo = 'prescription' | 'referral' | 'screening' | 'immunisation' | 'test' | 'record'

/**
 * Total rather than partial, so a kind added to the schema fails to compile
 * here until someone files it. `task` is in it only because the schema still
 * allows the kind: no rule has emitted one since problem and allergy replaced
 * it, and a row left over from before lands under `record` rather than
 * disappearing from a count the clinician is reading.
 */
const SILO: Record<Doc<'recommendations'>['kind'], Silo> = {
  prescription: 'prescription',
  referral: 'referral',
  screening: 'screening',
  immunisation: 'immunisation',
  test: 'test',
  problem: 'record',
  allergy: 'record',
  task: 'record',
}

const siloCounts = v.object({
  prescription: v.number(),
  referral: v.number(),
  screening: v.number(),
  immunisation: v.number(),
  test: v.number(),
  record: v.number(),
})

function countBySilo(rows: readonly Doc<'recommendations'>[]): Record<Silo, number> {
  const counts: Record<Silo, number> = {
    prescription: 0,
    referral: 0,
    screening: 0,
    immunisation: 0,
    test: 0,
    record: 0,
  }
  for (const row of rows) counts[SILO[row.kind]] += 1
  return counts
}

/**
 * Everything the SBAR header needs, in its four bands.
 *
 * Null for a patient who is not there, rather than a throw: this drives a route
 * that can be linked to after the row is gone, and a blank header reads better
 * than an error page. `convex/review.ts` does the same.
 */
export const summary = query({
  args: { patientId: v.id('patients') },
  returns: v.union(
    v.null(),
    v.object({
      situation: v.object({
        _id: v.id('patients'),
        name: v.string(),
        birthDate: v.string(),
        country: v.string(),
        sex: patientFields.sex,
        stage: patientFields.stage,
        proposedCount: v.number(),
      }),
      background: v.object({
        problems: v.array(backgroundItem),
        medications: v.array(backgroundItem),
        allergies: v.array(backgroundItem),
        /**
         * The call asked about allergies and the question is no longer open.
         * An empty allergy list means nothing on its own: "none found in the
         * documents" and "none, and we asked the patient" are different
         * clinical facts and the band has to be able to say which it has.
         */
        allergiesAsked: v.boolean(),
      }),
      assessment: v.object({
        /** Live from `claims` against the frozen snapshot, per ADR 11. */
        recovery: v.object({ total: v.number(), recovered: v.number() }),
        proposedByConfidence: bucketCounts,
        /**
         * Claims whose quote failed to anchor in the document it names. Counted
         * with `=== false`, never `!== true`: absent means anchoring does not
         * apply, which is not a failure. See ADR 17.
         */
        unverifiedClaims: v.number(),
      }),
      /** Still-proposed rows per silo, like every other count here: the work left to decide. */
      recommendation: siloCounts,
      /**
       * Every gap, whatever its status. An answered or unanswered one is
       * currently invisible to a clinician, which throws away the point of
       * making the call. ADR 3 refuses to suppress an unresolved row and the
       * same applies to a question. See ADR 22.
       */
      gaps: v.array(gapDoc),
      recommendations: v.array(recommendationDoc),
    }),
  ),
  handler: async (ctx, { patientId }) => {
    const patient = await ctx.db.get('patients', patientId)
    if (!patient) return null

    const claims = await ctx.db
      .query('claims')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(CLAIM_CAP)
    const recommendations = await ctx.db
      .query('recommendations')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(RECOMMENDATION_CAP)
    const gaps = await ctx.db
      .query('gaps')
      .withIndex('by_patient', (q) => q.eq('patientId', patientId))
      .take(GAP_CAP)

    const proposed = recommendations.filter((row) => row.status === 'proposed')

    return {
      situation: {
        _id: patient._id,
        name: patient.name,
        birthDate: patient.birthDate,
        country: patient.country,
        sex: patient.sex,
        stage: patient.stage,
        proposedCount: proposed.length,
      },
      background: {
        problems: backgroundItems(claims, 'condition'),
        medications: backgroundItems(claims, 'medication'),
        allergies: backgroundItems(claims, 'allergy'),
        allergiesAsked: gaps.some((gap) => gap.ruleId === ALLERGY_GAP_RULE && gap.status !== 'open'),
      },
      assessment: {
        // The matcher, not a second copy of it: `convex/recovery.ts` computes
        // the same number from the same pure function, and a query cannot call
        // another query anyway.
        recovery: matchRecovery(patient.truth, claims),
        proposedByConfidence: countByConfidence(proposed),
        unverifiedClaims: claims.filter((claim) => claim.source.verified === false).length,
      },
      recommendation: countBySilo(proposed),
      gaps,
      recommendations,
    }
  },
})
