import { normaliseKey } from '../src/lib/normalise'
import type { Confidence } from '../src/types'
import type { PatientProfile, ProfileFact, Rule, RuleOutcome } from './types'

/**
 * Diabetic eye screening. The only rule in the pack triggered by the patient's
 * own problem list rather than by age arithmetic or a synthesised card, so it is
 * the one that proves the engine reads the record.
 *
 * See #16 and docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

/** From the quoted eligibility line, not from the pack. */
const FIRST_INVITED_AGE = 12

/**
 * Normalised through ADR 11's matcher rather than written pre-normalised, so the
 * term and the profile's keys cannot drift apart.
 */
const DIABETES = normaliseKey('diabetes')

/**
 * ADR 11's match: normalised substring, either direction. The sim writes
 * "Diabetes" and a UK record writes "Type 2 diabetes mellitus", so one direction
 * would miss half the records. Generous by design: "diabetes insipidus" matches
 * too, and the clinician review before write-back is what catches that.
 *
 * An empty key is excluded because every string contains '', so an unkeyable
 * condition would otherwise match.
 */
function isDiabetes(fact: ProfileFact): boolean {
  if (fact.key.length === 0) return false
  return fact.key.includes(DIABETES) || DIABETES.includes(fact.key)
}

/** Weakest last, matching ADR 14's ordering. */
const BUCKET_ORDER: Confidence[] = ['document-evidenced', 'patient-reported', 'uncertain-mapping']

/**
 * The referral rests on one problem-list entry, so it rests on the best-evidenced
 * one. ADR 14's minimum-of applies across the distinct facts a recommendation
 * needs; two entries saying the same thing are not two links in a chain, and
 * consuming the weaker duplicate would understate evidence the record holds.
 */
function bestEvidenced(facts: ProfileFact[]): ProfileFact | undefined {
  return [...facts].sort(
    (a, b) => BUCKET_ORDER.indexOf(a.confidence) - BUCKET_ORDER.indexOf(b.confidence),
  )[0]
}

export const rule: Rule = {
  id: 'nhs-screen-diabetic-eye',
  kind: 'screening',
  target: 'referrals',
  countries: 'all',
  reads: 'The active problem list, for diabetes, and age. Fires from 12 upwards.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/diabetic-eye-screening-programme-overview',
      quote: 'Everyone with diabetes who is 12 years old or over is invited for eye screening.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    if (profile.ageYears < FIRST_INVITED_AGE) return []

    // `conditions` is the active set: the sim's problem list carries `status` and
    // the profile does not, so resolution is settled before a rule sees it. A
    // degraded document that lost the resolution presents as current, which is
    // what a real migrating record does. See CONTEXT.md known gaps.
    const diabetes = bestEvidenced(profile.conditions.filter(isDiabetes))
    if (!diabetes) return []

    return [
      {
        kind: 'recommendation',
        outputKey: 'nhs-screen-diabetic-eye:invite',
        // The sim drops `text` on create_referral, so the evidence travels here.
        title: `Diabetic eye screening: "${diabetes.verbatim}" on the problem list, aged ${profile.ageYears}`,
        rationale: `Diabetes recorded as "${diabetes.verbatim}" and aged ${profile.ageYears}, so inside the invited group. Refer for diabetic eye screening.`,
        consumed: [diabetes],
      },
    ]
  },
}
