import type { PatientProfile, Rule, RuleOutcome } from './types'

/** Stub. Encoded by #17. Replace this whole file; do not edit rules/index.ts. */
export const rule: Rule = {
  id: 'ukhsa-new-arrival-orientation',
  kind: 'referral',
  target: 'gp',
  priority: 3,
  countries: 'all',
  reads: 'Country of origin only. Fires for every patient.',
  citations: [{ url: 'https://www.gov.uk/guidance/nhs-entitlements-migrant-health-guide', quote: 'explain to them how the NHS works and their entitlements to healthcare' }],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return []
  },
}
