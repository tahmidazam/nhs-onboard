import type { PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Puts a condition read out of the foreign record onto the GP problem list.
 *
 * Every other rule proposes work to do. This one proposes the history itself,
 * which is the thing the patient actually arrived with and the thing an empty
 * UK record is missing. One outcome per condition, so the GP accepts or refuses
 * each on its own evidence rather than the set as a block.
 *
 * See docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

export const rule: Rule = {
  id: 'nhs-record-condition',
  kind: 'problem',
  target: 'gp',
  countries: 'all',
  reads: 'Every condition extracted from the records.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
      quote: 'Offer migrants the same basic new patient check as for all registering patients.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    return profile.conditions.map((fact) => ({
      kind: 'recommendation',
      outputKey: `nhs-record-condition:${fact.key}`,
      title: fact.resolved ?? fact.verbatim,
      rationale: `The records give this as ${fact.verbatim}. Adding it to the problem list carries the patient's history onto the UK record, where nothing currently stands against it.`,
      consumed: [fact],
    }))
  },
}
