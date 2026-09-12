import type { PatientProfile, Rule, RuleOutcome } from './types'

/** Stub. Encoded by #16. Replace this whole file; do not edit rules/index.ts. */
export const rule: Rule = {
  id: 'nhs-screen-bowel',
  kind: 'screening',
  target: 'referrals',
  priority: 2,
  countries: 'all',
  reads: 'Age, from the frozen snapshot.',
  citations: [{ url: 'https://www.gov.uk/guidance/bowel-cancer-screening-programme-overview', quote: 'TODO(quote)' }],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return []
  },
}
