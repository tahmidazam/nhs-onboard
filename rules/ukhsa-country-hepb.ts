import type { PatientProfile, Rule, RuleOutcome } from './types'

/** Stub. Encoded by #17. Replace this whole file; do not edit rules/index.ts. */
export const rule: Rule = {
  id: 'ukhsa-country-hepb',
  kind: 'screening',
  target: 'referrals',
  priority: 2,
  countries: [],
  reads: 'Country of origin, against the generated hepatitis B list.',
  citations: [{ url: 'https://www.gov.uk/guidance/hepatitis-b-migrant-health-guide', quote: 'TODO(quote)' }],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return []
  },
}
