import { stated } from './negation'
import type { PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Asks the patient about allergy when the record states none.
 *
 * Priority 1, ahead of everything else the call carries, for the reason
 * nhs-record-allergy.ts:7-9 already gives: an allergy is the one piece of
 * history that changes what a prescriber may safely do next. Every other gap in
 * the pack closes a fact a clinician would like to have. This one closes the
 * fact a prescription is unsafe without, so it fills the call first.
 *
 * It fires on `stated(profile.allergies)` rather than on `profile.allergies`,
 * because the degrader writes "Patient could not recall any known drug
 * allergies." into a section it emptied and extraction reads that back as an
 * allergy claim. A record with one such claim and nothing else says nothing
 * about allergy at all. See rules/negation.ts.
 *
 * The question is open, and never a confirmation. Not "your records say you
 * have no allergies, is that right?": docs/vapi-system-prompt.md is explicit
 * that a tired or polite patient says yes to anything phrased that way, and
 * that patients agree with confident-sounding suggestions, which is the whole
 * ground of its acquiescence check and of rung 2's reversed burden. A
 * confirmation-shaped question manufactures the negative it was meant to test,
 * and the negative it manufactures is the one that reaches a prescriber.
 *
 * `consumed: profile.allergies` is deliberate, not an oversight. The array is
 * what the record holds, negatives included, so consuming it is what carries
 * ADR 14's synthesised flag through rules/engine.ts and puts the "could not
 * recall" line into the gap's own evidence. The review screen can then show
 * why the question is being asked rather than asserting that the record is
 * blank when it is not.
 *
 * See docs/adr/0014-rule-output-inherits-the-weakest-evidence.md and ADR 16,
 * which makes gap selection a sort on the priority declared here.
 */

export const rule: Rule = {
  id: 'nhs-ask-allergies',
  /**
   * This rule emits only a gap, so `kind` and `target` never reach an outcome
   * and the engine reads neither. They say where the answer lands when the
   * post-call re-run turns it into a fact: nhs-record-allergy puts it on the GP
   * record as an allergy.
   */
  kind: 'allergy',
  target: 'gp',
  priority: 1,
  countries: 'all',
  reads: 'Extracted allergies, counting only those that state a substance. A section filled with "could not recall any known drug allergies" states none.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
      quote: 'Offer migrants the same basic new patient check as for all registering patients.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    if (stated(profile.allergies).length > 0) return []

    return [
      {
        kind: 'gap',
        outputKey: 'nhs-ask-allergies:any',
        // Open, one topic, and phrased for speech. Tracks call plan step 5:
        // any medicine, food or other substance, and what actually happened.
        // Never asks the patient to confirm an absence.
        question:
          'Is there any medicine, food, or anything else that you have a bad reaction to? For each one, tell me what actually happens when you have it.',
        consumed: profile.allergies,
      },
    ]
  },
}
