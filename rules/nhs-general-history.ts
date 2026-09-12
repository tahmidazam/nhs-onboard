import { stated } from './negation'
import type { PatientProfile, ProfileFact, Rule, RuleOutcome } from './types'

/**
 * The four history sections a new patient check covers, asked whenever the
 * record cannot fill one: past medical history, drug history, family history,
 * social history.
 *
 * Thin is defined per section rather than as a global threshold. A section is
 * thin when it carries no stated fact at all, and that is the whole test. A
 * number like "fewer than six facts" is a dial nobody can defend at review:
 * asked why six, the honest answer is that five looked too few, which is ADR
 * 3's objection to a confidence score restated one layer up. "This section says
 * nothing" needs no threshold, reads the same on a 34-year-old and on an
 * 80-year-old, and degrades correctly as the record gets thinner.
 *
 * Stated, not present: the degrader fills an emptied section with a sentence,
 * so a conditions array holding only "No further history recorded at this
 * visit." is a thin section, not a full one. See rules/negation.ts.
 *
 * The obvious objection is that the Vapi call plan already collects medicines,
 * conditions, family history and lifestyle unconditionally, at steps 4, 6, 8, 9
 * and 10, so why emit a gap at all. Because a gap is the only structure that
 * can afterwards record that we asked and got nothing. ADR 22 gives `gaps` the
 * `'unanswered'` status for exactly that outcome, and without a gap row there
 * is nothing to set it on and no line on the review screen, so "we asked, she
 * does not know" would be stored as the same thing as "nobody asked". The
 * prompt's CALL PLAN is best-effort and skippable when the patient tires;
 * `{{goals}}` is what the call must not end without, and a gap is how a section
 * gets into `{{goals}}`.
 *
 * Priority 3: these are the questions a clinician would like answered, behind
 * the allergy the prescriber needs and the immunisation catch-up the child
 * needs. ADR 16 sorts the call on that number and takes five.
 *
 * See docs/adr/0003-three-confidence-buckets.md,
 * docs/adr/0016-extraction-is-the-only-model-stage.md,
 * docs/adr/0022-the-call-answers-gaps.md and docs/vapi-system-prompt.md.
 */

interface Section {
  /** The discriminator in `outputKey`, so a renamed section orphans gap rows. */
  slug: 'pmh' | 'dh' | 'fh' | 'sh'
  /**
   * The facts the record holds for this section, negatives included. Undefined
   * for social history, which no ClaimKind can carry. The whole array is
   * consumed, so the sentence that emptied the section travels into the gap's
   * evidence and the screen can show why the question is being asked.
   */
  facts: (profile: PatientProfile) => ProfileFact[] | undefined
  /** Authored here, in English, for speech. The adjudicator never rewrites it. */
  question: string
}

/**
 * One topic per gap, tracking the call plan step that collects it. The wording
 * is spoken aloud, so it is short sentences and no lists of options to choose
 * from, per HOW YOU SPEAK.
 */
const SECTIONS: readonly Section[] = [
  {
    // Call plan step 6.
    slug: 'pmh',
    facts: (profile) => profile.conditions,
    question:
      'Has a doctor ever told you that you have a condition you are treated or watched for? Include anything you have had an operation for, and roughly when.',
  },
  {
    // Call plan step 4. The ladder in VERIFICATION is how the answer is taken
    // down; this is only what has to be asked.
    slug: 'dh',
    facts: (profile) => profile.medications,
    question:
      'What medicines do you take regularly? Include anything you brought with you from abroad, and anything you buy yourself without a prescription.',
  },
  {
    // Call plan step 8. Approximations accepted without pushing, per THE FOUR
    // ANSWER STATES.
    slug: 'fh',
    facts: (profile) => profile.familyHistory,
    question:
      'Thinking about your parents, brothers and sisters: has any of them had a heart attack, a stroke, diabetes, cancer, or high blood pressure? If so, which relative, and roughly what age were they?',
  },
  {
    // Call plan steps 9 and 10. Asked as one section because nothing in the
    // record can ever answer any part of it.
    slug: 'sh',
    facts: () => undefined,
    question:
      'A few things about day to day life. Do you smoke now, or did you before? Roughly how much alcohol do you drink in a usual week, if any? What work do you do? And does anyone depend on you for their care, or look after you?',
  },
]

export const rule: Rule = {
  id: 'nhs-general-history',
  /**
   * Gap-only, so the engine reads neither of these: they say where an answer
   * lands once the post-call re-run turns it into a fact. Conditions go onto
   * the problem list through nhs-record-condition, medicines through
   * nhs-continue-medication, both at the practice.
   */
  kind: 'problem',
  target: 'gp',
  priority: 3,
  countries: 'all',
  reads:
    'Extracted conditions, medications and family history, counting only those that state something. Social history is read from nothing: there is no ClaimKind for smoking, alcohol, occupation or carer status, so no document and no extraction can carry one and that gap always fires.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
      quote: 'Offer migrants the same basic new patient check as for all registering patients.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    const outcomes: RuleOutcome[] = []

    for (const section of SECTIONS) {
      const facts = section.facts(profile)
      // undefined is social history: nothing in the record can answer it, so
      // there is no section to find thin and the gap is unconditional.
      if (facts !== undefined && stated(facts).length > 0) continue

      outcomes.push({
        kind: 'gap',
        outputKey: `nhs-general-history:${section.slug}`,
        question: section.question,
        consumed: facts ?? [],
      })
    }

    return outcomes
  },
}
