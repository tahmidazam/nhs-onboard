import type { Confidence, RecommendationKind } from '@/types'

/**
 * The three confidence buckets as the screen says them, in one place.
 *
 * Lifted out of `src/routes/Rules.tsx` and the old review card, which each
 * held their own copy of the variant map. The mapping is load-bearing rather
 * than decorative: per the UI conventions these three badge variants mean a
 * confidence bucket and nothing else, anywhere in the app, so a third copy
 * drifting is how that guarantee breaks.
 *
 * See docs/adr/0003-three-confidence-buckets.md.
 */

/** Per the badge table in the UI conventions. One colour, one meaning. */
export const BUCKET_VARIANT: Record<Confidence, 'default' | 'secondary' | 'outline'> = {
  'document-evidenced': 'default',
  'patient-reported': 'secondary',
  'uncertain-mapping': 'outline',
}

/**
 * What a clinician reads, rather than the wire value. `uncertain-mapping` says
 * "Uncertain" and not "Uncertain mapping", because to the person reading it the
 * mapping is not the point: the fact is not safe to act on.
 */
export const BUCKET_LABEL: Record<Confidence, string> = {
  'document-evidenced': 'Document verified',
  'patient-reported': 'Patient reported',
  'uncertain-mapping': 'Uncertain',
}

/**
 * The buckets as object keys, for a payload that has to carry one count per
 * bucket. Camel case rather than the wire values because a Convex validator
 * key has to be a valid identifier and `document-evidenced` is not: the hyphen
 * typechecks and is rejected at push time. `convex/clinic.ts` declares the
 * matching validator, and this is the one map that turns a `Confidence` into
 * the key that reads it.
 */
export type BucketKey = 'documentEvidenced' | 'patientReported' | 'uncertainMapping'

/** Exhaustive over the union, so a fourth bucket fails the typecheck here. */
export const BUCKET_KEY: Record<Confidence, BucketKey> = {
  'document-evidenced': 'documentEvidenced',
  'patient-reported': 'patientReported',
  'uncertain-mapping': 'uncertainMapping',
}

/** Weakest last, matching the ordering in rules/engine.ts. */
export const BUCKET_ORDER: readonly Confidence[] = [
  'document-evidenced',
  'patient-reported',
  'uncertain-mapping',
]

/**
 * The silos on the clinician screen, in the order they render. Grouped by what
 * a GP has to do, not by which sim site owns the result: `problem` and
 * `allergy` land on the record rather than leaving the practice, so they share
 * one silo.
 *
 * `task` has no silo. Nothing in the pack emits one since the orientation rule
 * was removed, and a silo that is always empty is noise on a screen whose
 * whole point is brevity. A rule reintroducing `task` fails the exhaustiveness
 * check in KIND_SILO below rather than rendering nowhere.
 */
export type SiloId = 'prescription' | 'referral' | 'screening' | 'immunisation' | 'test' | 'record'

/**
 * `title` heads the silo. `one` and `many` are the lower-case forms the SBAR
 * band needs to read as a sentence: a count-leading phrase wants "2
 * prescriptions", not "Prescriptions 2". Both are spelled out rather than
 * derived, because "Screening" does not pluralise by adding an s and "for the
 * record" is not a noun at all.
 */
export const SILOS: readonly { id: SiloId; title: string; one: string; many: string }[] = [
  { id: 'prescription', title: 'Prescriptions', one: 'prescription', many: 'prescriptions' },
  { id: 'referral', title: 'Referrals', one: 'referral', many: 'referrals' },
  { id: 'screening', title: 'Screening', one: 'screening test', many: 'screening tests' },
  { id: 'immunisation', title: 'Immunisations', one: 'immunisation', many: 'immunisations' },
  { id: 'test', title: 'Tests', one: 'test', many: 'tests' },
  { id: 'record', title: 'For the record', one: 'record entry', many: 'record entries' },
]


/**
 * Exhaustive over the union, so a new recommendation kind fails the typecheck
 * here instead of falling out of every silo and vanishing from the screen.
 */
export const KIND_SILO: Record<RecommendationKind, SiloId | null> = {
  prescription: 'prescription',
  referral: 'referral',
  screening: 'screening',
  immunisation: 'immunisation',
  test: 'test',
  problem: 'record',
  allergy: 'record',
  // Nothing emits this. Kept mapped so the Record stays exhaustive.
  task: null,
}

/**
 * Tailwind classes per silo, from the `--silo-*` theme tokens in
 * `src/index.css`. A Record rather than a template string because Tailwind
 * cannot see a class name it has to compute.
 */
export const SILO_ACCENT: Record<SiloId, string> = {
  prescription: 'border-l-silo-prescription',
  referral: 'border-l-silo-referral',
  screening: 'border-l-silo-screening',
  immunisation: 'border-l-silo-immunisation',
  test: 'border-l-silo-test',
  record: 'border-l-silo-record',
}

export const SILO_TEXT: Record<SiloId, string> = {
  prescription: 'text-silo-prescription',
  referral: 'text-silo-referral',
  screening: 'text-silo-screening',
  immunisation: 'text-silo-immunisation',
  test: 'text-silo-test',
  record: 'text-silo-record',
}
