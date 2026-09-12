import type { PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Puts an allergy read out of the foreign record onto the GP record.
 *
 * Separate from the problem rule because the sim holds allergies as their own
 * resource, and because an allergy is the one piece of history that changes
 * what a prescriber may safely do next.
 *
 * See docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

export const rule: Rule = {
  id: 'nhs-record-allergy',
  kind: 'allergy',
  target: 'gp',
  countries: 'all',
  reads: 'Every allergy extracted from the records.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
      quote: 'Offer migrants the same basic new patient check as for all registering patients.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    return profile.allergies.map((fact) => ({
      kind: 'recommendation',
      outputKey: `nhs-record-allergy:${fact.key}`,
      title: fact.resolved ?? fact.verbatim,
      rationale: `The records give this as ${fact.verbatim}. Until it reaches the UK record, a prescriber here has no sight of it.`,
      consumed: [fact],
    }))
  },
}
