import type { PatientProfile, Rule, RuleOutcome } from './types'

/** Stub. Encoded by #15. Replace this whole file; do not edit rules/index.ts. */
export const rule: Rule = {
  id: 'ukhsa-imm-primary-course',
  kind: 'immunisation',
  target: 'gp',
  priority: 1,
  countries: 'all',
  reads: 'Recorded immunisations, or their absence, and age.',
  citations: [{ url: 'https://www.gov.uk/government/publications/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation-status', quote: 'unless there is a documented or reliable verbal vaccine history, individuals should be assumed to be unimmunised and a full course of immunisations planned' }],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return []
  },
}
