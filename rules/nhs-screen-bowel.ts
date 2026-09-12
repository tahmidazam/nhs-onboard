import type { PatientProfile, ProfileFact, Rule, RuleOutcome } from './types'

/**
 * Bowel cancer screening. Age alone decides it, and the age comes from the sim's
 * own birthDate, so this is the one rule in the pack whose output rests on
 * nothing invented and can be written back.
 *
 * See #16 and docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

/** Inclusive, both ends. From the quoted invitation range, not from the pack. */
const FIRST_INVITED_AGE = 50
const LAST_INVITED_AGE = 74

/**
 * The age as a fact the engine can bucket. ADR 14 treats age read from the
 * frozen snapshot as a claim like any other, `sim-record` and so
 * `document-evidenced`. PatientProfile exposes the arithmetic rather than the
 * birthDate it came from, so the quote names the age and the clock it was taken
 * against: both are checkable against the sim record the id points at.
 */
function ageFact(profile: PatientProfile): ProfileFact {
  return {
    key: 'age',
    verbatim: `${profile.ageYears} years`,
    confidence: 'document-evidenced',
    source: {
      kind: 'sim-record',
      id: profile.patientId,
      quote: `aged ${profile.ageYears} as of ${profile.asOf}`,
    },
    synthesised: false,
  }
}

export const rule: Rule = {
  id: 'nhs-screen-bowel',
  kind: 'screening',
  target: 'referrals',
  priority: 2,
  countries: 'all',
  reads: 'Age, from the frozen snapshot. Fires between 50 and 74 inclusive.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/bowel-cancer-screening-programme-overview',
      quote: 'We invite people aged 50 to 74 years for bowel cancer screening every 2 years.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    if (profile.ageYears < FIRST_INVITED_AGE || profile.ageYears > LAST_INVITED_AGE) return []

    return [
      {
        kind: 'recommendation',
        outputKey: 'nhs-screen-bowel:invite',
        // The sim drops `text` on create_referral, so the evidence travels here.
        title: `Bowel cancer screening: aged ${profile.ageYears}, inside the 50 to 74 invitation range, offered every 2 years`,
        rationale: `Aged ${profile.ageYears} as of ${profile.asOf}, from the sim record. Refer into the two-yearly bowel cancer screening cycle.`,
        consumed: [ageFact(profile)],
      },
    ]
  },
}
