import type { PatientProfile, Rule, RuleOutcome } from './types'

/** Stub. Encoded by #16. Replace this whole file; do not edit rules/index.ts. */
export const rule: Rule = {
  id: 'nhs-screen-diabetic-eye',
  kind: 'screening',
  target: 'referrals',
  priority: 2,
  countries: 'all',
  reads: 'Active conditions, and age.',
  citations: [{ url: 'https://www.gov.uk/guidance/diabetic-eye-screening-programme-overview', quote: 'TODO(quote)' }],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return []
  },
}
