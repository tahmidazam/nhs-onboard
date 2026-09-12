import type { Claim, SourceRef } from '../src/types'
import { buildProfile } from './profile'
import type { PatientProfile } from './types'

/**
 * The profile spread the coverage test runs the whole pack over, and the claim
 * builders the pack invariants share with it. Fixtures only: no IO, nothing from
 * Convex, no model.
 *
 * ADR 12 forbids curating the patient and #5 lets a judge nominate anyone from
 * the sim's 50,000, so the spread is deliberately unflattering: seven ages, each
 * with a record and without one, each with the synthesised vaccination card and
 * without it. `sex` never appears, because the sim carries none and a column
 * that is always undefined varies nothing. See CONTEXT.md known gaps.
 *
 * Adding a case is adding a row to SPREAD.
 */

/**
 * The frozen simulation clock, which reads 2026-09-12T08:00:00Z, paused. Every
 * age below derives from it, so no fixture ages overnight.
 * See docs/adr/0011-recovery-is-measured-against-a-frozen-snapshot.md.
 */
export const AS_OF = '2026-09-12T08:00:00Z'

/** A document the degrader assembled from the sim's frozen snapshot. */
export const RECORD_DOCUMENT_ID = 'doc-discharge-summary'

/**
 * The generated vaccination card. Passed to buildProfile as a synthesised
 * document id, because the sim holds no immunisations on any of its patients
 * and a Claim does not carry the flag. See ADR 8.
 */
export const CARD_DOCUMENT_ID = 'doc-vaccination-card'

/** A Vapi call, whose answers arrive as `patient-reported` claims. */
export const TRANSCRIPT_ID = 'call-0001'

/** One claim to build, named by the document it came from. */
export interface ClaimSpec {
  kind: Claim['kind']
  /** As the source wrote it. Immunisation dates and dose numbers are parsed out of this. */
  verbatim: string
  docId: string
  sourceKind?: SourceRef['kind']
  confidence?: Claim['confidence']
  /** dm+d UK ingredient, so a medication keys on the ingredient rather than the brand. ADR 11. */
  ukIngredient?: string
}

export function claimsFrom(patientId: string, specs: readonly ClaimSpec[]): Claim[] {
  return specs.map((spec, index) => ({
    id: `${patientId}-claim-${index + 1}`,
    patientId,
    kind: spec.kind,
    verbatim: spec.verbatim,
    confidence: spec.confidence ?? 'document-evidenced',
    source: {
      kind: spec.sourceKind ?? 'document',
      id: spec.docId,
      quote: spec.verbatim,
    },
    ...(spec.ukIngredient === undefined
      ? {}
      : {
          mapping: {
            brand: spec.verbatim,
            ukIngredient: spec.ukIngredient,
            via: 'bd-medex' as const,
            unresolved: false,
          },
        }),
  }))
}

/** Builds a profile the way the Convex step does: patient, claims, frozen clock. */
export function profileFrom(spec: {
  patientId?: string
  birthDate: string
  country?: string
  claims?: readonly ClaimSpec[]
}): PatientProfile {
  const patientId = spec.patientId ?? 'SIM-COVERAGE'
  return buildProfile(
    { patientId, birthDate: spec.birthDate, country: spec.country ?? 'BD' },
    claimsFrom(patientId, spec.claims ?? []),
    AS_OF,
    [CARD_DOCUMENT_ID],
  )
}

/** What the degraded documents carried about the patient, apart from vaccines. */
interface RecordDepth {
  conditions: string[]
  medications: Array<{ verbatim: string; ukIngredient?: string }>
  allergies: string[]
}

/**
 * ADR 12's thin patient: a random roll landed on someone with nothing to
 * extract, and every rule keyed on the record sits out.
 */
const NOTHING: RecordDepth = { conditions: [], medications: [], allergies: [] }

/** Age-appropriate for an infant or a young child, so no rule fires on a condition an infant cannot have. */
const CHILD_RECORD: RecordDepth = {
  conditions: ['Asthma'],
  medications: [{ verbatim: 'Ventolin inhaler', ukIngredient: 'Salbutamol' }],
  allergies: ['Peanut'],
}

/** The common adult presentation, and the one a judge is most likely to roll. */
const ADULT_RECORD: RecordDepth = {
  conditions: ['Essential hypertension', 'Type 2 diabetes mellitus'],
  medications: [
    { verbatim: 'Napa 500mg', ukIngredient: 'Paracetamol' },
    { verbatim: 'Metfo 500mg', ukIngredient: 'Metformin hydrochloride' },
  ],
  allergies: ['Penicillin'],
}

/** The degrader generated no card for this patient. ADR 8 makes it an option, not a guarantee. */
const NO_CARD: string[] = []

/** One dated dose of the infant ladder, so the plan resumes rather than restarts. */
const INFANT_CARD = ['Pentavalent (DTP-HepB-Hib), dose 1, 2026-06-05']

/** Measles at nine months abroad: the dose that looks like cover and is not. */
const CHILD_CARD = ['DTP, dose 1, 2022-05-15', 'Measles vaccine, 2022-12-20']

/** A completed primary course, and a measles dose whose age the card does not state. */
const TEENAGE_CARD = ['DTaP/IPV, dose 3, 2011-06-10', 'Measles vaccine, given as a child']

/** Both doses dated, the measles one before the first birthday. */
const ADULT_CARD = ['DTP, 1992-05-10', 'MMR, 1992-10-05']

/** A year alone, which cannot settle whether a dose preceded 12 months. */
const MIDLIFE_CARD = ['Tetanus toxoid, 1980']

/** Neither dose dated at all: the card a call has to close. */
const LATE_CARD = ['Polio (OPV), as a child', 'Measles vaccine, date unknown']

/** Nothing on the primary course ladder, so the full course is planned. */
const ELDERLY_CARD = ['Smallpox vaccination, 1950']

export interface SpreadCase {
  /** Completes the sentence "produces at least one outcome for ...". */
  label: string
  birthDate: string
  /** Claimed age, asserted against what the profile derives from birthDate and asOf. */
  ageYears: number
  ageMonths: number
  /** ISO 3166-1 alpha-2. BD and IN are on the hepatitis B list; FR and UA are not. */
  country: string
  record: RecordDepth
  /** Rows on the synthesised vaccination card, verbatim. */
  card: string[]
}

/**
 * Seven ages, two record depths, two card states. Twenty-eight patients, none of
 * whom may produce an empty review screen.
 */
export const SPREAD: SpreadCase[] = [
  // Infant, five months old. The primary course ladder starts at eight weeks.
  { label: 'an infant of five months with nothing on record and no card', birthDate: '2026-04-02', ageYears: 0, ageMonths: 5, country: 'BD', record: NOTHING, card: NO_CARD },
  { label: 'an infant of five months with nothing on record and a card', birthDate: '2026-04-02', ageYears: 0, ageMonths: 5, country: 'BD', record: NOTHING, card: INFANT_CARD },
  { label: 'an infant of five months with a record and no card', birthDate: '2026-04-02', ageYears: 0, ageMonths: 5, country: 'BD', record: CHILD_RECORD, card: NO_CARD },
  { label: 'an infant of five months with a record and a card', birthDate: '2026-04-02', ageYears: 0, ageMonths: 5, country: 'BD', record: CHILD_RECORD, card: INFANT_CARD },

  // Child of four, below the age every screening programme in the pack invites.
  { label: 'a child of four with nothing on record and no card', birthDate: '2022-03-10', ageYears: 4, ageMonths: 54, country: 'BD', record: NOTHING, card: NO_CARD },
  { label: 'a child of four with nothing on record and a card', birthDate: '2022-03-10', ageYears: 4, ageMonths: 54, country: 'BD', record: NOTHING, card: CHILD_CARD },
  { label: 'a child of four with a record and no card', birthDate: '2022-03-10', ageYears: 4, ageMonths: 54, country: 'BD', record: CHILD_RECORD, card: NO_CARD },
  { label: 'a child of four with a record and a card', birthDate: '2022-03-10', ageYears: 4, ageMonths: 54, country: 'BD', record: CHILD_RECORD, card: CHILD_CARD },

  // Seventeen: old enough for diabetic eye screening, too young for bowel.
  { label: 'a 17-year-old with nothing on record and no card', birthDate: '2009-05-04', ageYears: 17, ageMonths: 208, country: 'IN', record: NOTHING, card: NO_CARD },
  { label: 'a 17-year-old with nothing on record and a card', birthDate: '2009-05-04', ageYears: 17, ageMonths: 208, country: 'IN', record: NOTHING, card: TEENAGE_CARD },
  { label: 'a 17-year-old with a record and no card', birthDate: '2009-05-04', ageYears: 17, ageMonths: 208, country: 'IN', record: ADULT_RECORD, card: NO_CARD },
  { label: 'a 17-year-old with a record and a card', birthDate: '2009-05-04', ageYears: 17, ageMonths: 208, country: 'IN', record: ADULT_RECORD, card: TEENAGE_CARD },

  // Thirty-four: the case the ticket names. Eligible for no screening by age alone.
  { label: 'a 34-year-old with nothing on record and no card', birthDate: '1992-01-10', ageYears: 34, ageMonths: 416, country: 'BD', record: NOTHING, card: NO_CARD },
  { label: 'a 34-year-old with nothing on record and a card', birthDate: '1992-01-10', ageYears: 34, ageMonths: 416, country: 'BD', record: NOTHING, card: ADULT_CARD },
  { label: 'a 34-year-old with a record and no card', birthDate: '1992-01-10', ageYears: 34, ageMonths: 416, country: 'BD', record: ADULT_RECORD, card: NO_CARD },
  { label: 'a 34-year-old with a record and a card', birthDate: '1992-01-10', ageYears: 34, ageMonths: 416, country: 'BD', record: ADULT_RECORD, card: ADULT_CARD },

  // Fifty-two, from a country whose UKHSA guide does not advise hepatitis B testing.
  { label: 'a 52-year-old from France with nothing on record and no card', birthDate: '1974-02-06', ageYears: 52, ageMonths: 631, country: 'FR', record: NOTHING, card: NO_CARD },
  { label: 'a 52-year-old from France with nothing on record and a card', birthDate: '1974-02-06', ageYears: 52, ageMonths: 631, country: 'FR', record: NOTHING, card: MIDLIFE_CARD },
  { label: 'a 52-year-old from France with a record and no card', birthDate: '1974-02-06', ageYears: 52, ageMonths: 631, country: 'FR', record: ADULT_RECORD, card: NO_CARD },
  { label: 'a 52-year-old from France with a record and a card', birthDate: '1974-02-06', ageYears: 52, ageMonths: 631, country: 'FR', record: ADULT_RECORD, card: MIDLIFE_CARD },

  // Sixty-seven, also outside the hepatitis B list, and inside the bowel range.
  { label: 'a 67-year-old from Ukraine with nothing on record and no card', birthDate: '1959-06-06', ageYears: 67, ageMonths: 807, country: 'UA', record: NOTHING, card: NO_CARD },
  { label: 'a 67-year-old from Ukraine with nothing on record and a card', birthDate: '1959-06-06', ageYears: 67, ageMonths: 807, country: 'UA', record: NOTHING, card: LATE_CARD },
  { label: 'a 67-year-old from Ukraine with a record and no card', birthDate: '1959-06-06', ageYears: 67, ageMonths: 807, country: 'UA', record: ADULT_RECORD, card: NO_CARD },
  { label: 'a 67-year-old from Ukraine with a record and a card', birthDate: '1959-06-06', ageYears: 67, ageMonths: 807, country: 'UA', record: ADULT_RECORD, card: LATE_CARD },

  // Eighty: past the bowel screening range, so age alone invites nothing again.
  { label: 'an 80-year-old with nothing on record and no card', birthDate: '1946-09-06', ageYears: 80, ageMonths: 960, country: 'BD', record: NOTHING, card: NO_CARD },
  { label: 'an 80-year-old with nothing on record and a card', birthDate: '1946-09-06', ageYears: 80, ageMonths: 960, country: 'BD', record: NOTHING, card: ELDERLY_CARD },
  { label: 'an 80-year-old with a record and no card', birthDate: '1946-09-06', ageYears: 80, ageMonths: 960, country: 'BD', record: ADULT_RECORD, card: NO_CARD },
  { label: 'an 80-year-old with a record and a card', birthDate: '1946-09-06', ageYears: 80, ageMonths: 960, country: 'BD', record: ADULT_RECORD, card: ELDERLY_CARD },
]

/** The profile for one row, built through the same projection the pipeline uses. */
export function profileFor(spread: SpreadCase, index = 0): PatientProfile {
  const { record, card } = spread
  return profileFrom({
    patientId: `SIM-COVERAGE-${String(index + 1).padStart(2, '0')}`,
    birthDate: spread.birthDate,
    country: spread.country,
    claims: [
      ...record.conditions.map((verbatim) => ({
        kind: 'condition' as const,
        verbatim,
        docId: RECORD_DOCUMENT_ID,
      })),
      ...record.medications.map((med) => ({
        kind: 'medication' as const,
        verbatim: med.verbatim,
        docId: RECORD_DOCUMENT_ID,
        ...(med.ukIngredient === undefined ? {} : { ukIngredient: med.ukIngredient }),
      })),
      ...record.allergies.map((verbatim) => ({
        kind: 'allergy' as const,
        verbatim,
        docId: RECORD_DOCUMENT_ID,
      })),
      ...card.map((verbatim) => ({
        kind: 'immunisation' as const,
        verbatim,
        docId: CARD_DOCUMENT_ID,
      })),
    ],
  })
}
