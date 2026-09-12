import type { PatientProfile, Rule, RuleOutcome } from './types'

/** Stub. Encoded by #15. Replace this whole file; do not edit rules/index.ts. */
export const rule: Rule = {
  id: 'ukhsa-imm-mmr-under-12-months',
  kind: 'immunisation',
  target: 'gp',
  priority: 2,
  countries: 'all',
  reads: 'Measles-containing doses and the age at which each was given.',
  citations: [{ url: 'https://www.gov.uk/government/publications/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation-status', quote: 'TODO(quote)' }],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return []
  },
}
