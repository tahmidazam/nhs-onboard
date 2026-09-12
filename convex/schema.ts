import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Server half of the shared contract. Mirrors src/types.ts. Owned by Dev A. */

const confidence = v.union(
  v.literal('document-evidenced'),
  v.literal('patient-reported'),
  v.literal('uncertain-mapping'),
)

const sourceRef = v.object({
  kind: v.union(v.literal('document'), v.literal('transcript'), v.literal('sim-record')),
  id: v.string(),
  quote: v.string(),
})

export default defineSchema({
  /** Drives the board. */
  patients: defineTable({
    simId: v.string(),
    name: v.string(),
    birthDate: v.string(),
    stage: v.union(
      v.literal('not-onboarded'),
      v.literal('degrading'),
      v.literal('documents-ready'),
      v.literal('extracting'),
      v.literal('mapping'),
      v.literal('applying-rules'),
      v.literal('awaiting-call'),
      v.literal('ready-for-review'),
      v.literal('actioned'),
    ),
    /** Answer key for `recovery`. */
    truth: v.object({
      conditions: v.array(v.string()),
      medications: v.array(v.string()),
      allergies: v.array(v.string()),
      immunisations: v.array(v.string()),
    }),
    recovery: v.optional(v.object({ total: v.number(), recovered: v.number() })),
  }).index('by_simId', ['simId']),

  /** Output of the degrader. */
  documents: defineTable({
    patientId: v.id('patients'),
    kind: v.union(
      v.literal('discharge-summary'),
      v.literal('vaccination-card'),
      v.literal('prescription-list'),
      v.literal('clinic-letter'),
    ),
    language: v.string(),
    country: v.string(),
    text: v.string(),
  }).index('by_patient', ['patientId']),

  /** One extracted fact with its source. */
  claims: defineTable({
    patientId: v.id('patients'),
    kind: v.union(
      v.literal('medication'),
      v.literal('condition'),
      v.literal('immunisation'),
      v.literal('family-history'),
      v.literal('allergy'),
    ),
    verbatim: v.string(),
    resolved: v.optional(v.string()),
    confidence,
    source: sourceRef,
    mapping: v.optional(
      v.object({
        brand: v.string(),
        generic: v.optional(v.string()),
        ukFormularyName: v.optional(v.string()),
        rag: v.optional(v.string()),
        via: v.union(
          v.literal('bd-medex'),
          v.literal('indian-medicines'),
          v.literal('idd'),
          v.literal('rxnav'),
          v.literal('unresolved'),
        ),
        unresolved: v.boolean(),
      }),
    ),
  }).index('by_patient', ['patientId']),

  /** `question` is also the voice agent's goal. */
  gaps: defineTable({
    patientId: v.id('patients'),
    question: v.string(),
    ruleId: v.string(),
    status: v.union(v.literal('open'), v.literal('answered')),
    answer: v.optional(v.string()),
  }).index('by_patient', ['patientId']),

  /** `target` is the sim site that owns the resource after write-back. */
  recommendations: defineTable({
    patientId: v.id('patients'),
    kind: v.union(
      v.literal('prescription'),
      v.literal('referral'),
      v.literal('screening'),
      v.literal('immunisation'),
      v.literal('test'),
    ),
    title: v.string(),
    rationale: v.string(),
    confidence,
    evidence: v.array(sourceRef),
    citation: v.optional(v.object({ url: v.string(), quote: v.string() })),
    target: v.union(
      v.literal('pharmacy'),
      v.literal('referrals'),
      v.literal('diagnostics'),
      v.literal('gp'),
    ),
    simResourceId: v.optional(v.string()),
    status: v.union(v.literal('proposed'), v.literal('approved'), v.literal('dismissed')),
  }).index('by_patient', ['patientId']),

  /** Foreign brand to generic. Seeded by `npm run data:seed`. */
  brands: defineTable({
    /** Lowercase, non-alphanumerics stripped. */
    key: v.string(),
    brand: v.string(),
    generic: v.string(),
    country: v.string(),
    via: v.string(),
  }).index('by_key', ['key']),

  /**
   * dm+d virtual products. `vtm` is the UK ingredient, `vmp` the prescribable
   * product written into draft_prescription.
   */
  dmd: defineTable({
    /** Normalised VTM name. */
    key: v.string(),
    vtmId: v.string(),
    vtmName: v.string(),
    vmpId: v.optional(v.string()),
    vmpName: v.optional(v.string()),
    form: v.optional(v.string()),
    route: v.optional(v.string()),
    bnfCode: v.optional(v.string()),
  }).index('by_key', ['key']).index('by_vtm', ['vtmId']),

  /** Cambridge and Peterborough formulary. Seeded by `npm run data:seed`. */
  formulary: defineTable({
    key: v.string(),
    drug: v.string(),
    chapter: v.string(),
    /** 'Green', 'Amber SCG', 'Red Hospital', 'Black', 'OTC'. */
    rag: v.string(),
  }).index('by_key', ['key']),

  calls: defineTable({
    patientId: v.id('patients'),
    vapiCallId: v.optional(v.string()),
    channel: v.union(v.literal('voice'), v.literal('chat')),
    language: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('in-progress'), v.literal('complete'), v.literal('failed')),
    transcript: v.optional(v.string()),
    gapIds: v.array(v.id('gaps')),
  }).index('by_patient', ['patientId']).index('by_vapiCallId', ['vapiCallId']),
})
