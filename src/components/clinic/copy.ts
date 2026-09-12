import type { Doc } from '../../../convex/_generated/dataModel'
import type { RecommendationKind, SimTarget, SourceRef } from '@/types'
import type { WriteBackRefusal } from '@/lib/writeBack'

/**
 * The words the clinician screen says, in one place.
 *
 * Lifted off the old review card, which held these beside its markup. The
 * confidence and silo maps are not here on purpose: `src/lib/buckets.ts` holds
 * the only copy of those, per the UI conventions' badge table.
 *
 * Everything here is short by design. ADR 21 moves the evidence chain into a
 * Sheet, so a label on the face of the screen has to survive being read in
 * passing and nothing more.
 */

/** Exhaustive over the union, so a new kind cannot render blank. */
export const KIND_COPY: Record<RecommendationKind, string> = {
  prescription: 'Prescription',
  referral: 'Referral',
  screening: 'Screening referral',
  immunisation: 'Immunisation plan',
  test: 'Test request',
  task: 'Task',
  problem: 'Problem for the record',
  allergy: 'Allergy for the record',
}

/** Where the row lands once written. The Sheet names it; the row does not. */
export const TARGET_COPY: Record<SimTarget, string> = {
  pharmacy: 'Pharmacy',
  referrals: 'Referrals',
  diagnostics: 'Diagnostics',
  gp: 'GP',
}

export const SOURCE_LABEL: Record<SourceRef['kind'], string> = {
  document: 'Document',
  transcript: 'Call transcript',
  'sim-record': 'Simulator record',
}

/**
 * Names what the clinician has to do about a refusal, per src/lib/writeBack.ts.
 * A row this covers still renders in its silo, untickable, with this sentence
 * beside it. ADR 3 suppresses nothing.
 */
export const REFUSAL_COPY: Record<WriteBackRefusal, string> = {
  'synthesised-evidence': 'Rests on a generated document. Cannot be written.',
  'unconfirmed-report': 'Confirm with the patient before writing.',
  'unresolved-mapping': 'Not resolved to a UK equivalent. Cannot be actioned.',
}

/**
 * The three gap states as a clinician reads them. `unanswered` is the one that
 * earns its own sentence: asked on the call and not established is a different
 * fact from never asked, and ADR 22 added the state so the screen could say so.
 */
export const GAP_STATUS_COPY: Record<Doc<'gaps'>['status'], string> = {
  open: 'Not asked yet',
  answered: 'Answered on the call',
  unanswered: 'Asked, not established',
}

/** Open questions first, then the ones the call failed to settle, then the settled. */
export const GAP_STATUS_ORDER: Record<Doc<'gaps'>['status'], number> = {
  open: 0,
  unanswered: 1,
  answered: 2,
}

/**
 * Whole years, against the wall clock rather than the sim clock. The sim clock
 * belongs to the operator shell (ADR 21) and an age that moves with it would
 * read as a bug on a clinical header.
 */
export function ageInYears(birthDate: string, now: Date = new Date()): number | null {
  const born = new Date(birthDate)
  if (Number.isNaN(born.getTime())) return null
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const months = now.getUTCMonth() - born.getUTCMonth()
  if (months < 0 || (months === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1
  return age < 0 ? null : age
}

const REGION_NAMES = new Intl.DisplayNames(['en-GB'], { type: 'region' })

/**
 * 'BD' as 'Bangladesh'. Not `selectableCountries()`, whose labels name the
 * brand dataset ('Bangladesh (MEDEX)') because that is what the operator is
 * choosing there. A handover line names the country.
 */
export function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code
  try {
    return REGION_NAMES.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

/** 'action' / 'actions', so a count reads as a sentence rather than '1 actions'. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm
}
