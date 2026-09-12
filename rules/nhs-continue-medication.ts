import type { PatientProfile, ProfileFact, Rule, RuleOutcome } from './types'

/**
 * Continuation of a medication the patient was established on abroad.
 *
 * One outcome per medication whose foreign brand resolved to a UK ingredient
 * through the deterministic lookup. An unresolved brand is left alone: the
 * engine's bucket already carries why, and a drug nobody could map is the one
 * thing that must never become a draft prescription.
 *
 * See docs/adr/0002-drug-mapping-is-deterministic.md and
 * docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 */

function resolvedMedications(profile: PatientProfile): ProfileFact[] {
  return profile.medications.filter((fact) => Boolean(fact.resolved))
}

export const rule: Rule = {
  id: 'nhs-continue-medication',
  kind: 'prescription',
  target: 'pharmacy',
  countries: 'all',
  reads: 'Medications whose foreign brand resolved to a dm+d UK ingredient.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
      quote:
        'Ask about any medication the patient is taking, including medicines bought over the counter or brought with them from abroad.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    return resolvedMedications(profile).map((fact) => ({
      kind: 'recommendation',
      outputKey: `nhs-continue-medication:${fact.key}`,
      title: `Continue ${fact.resolved}, taken abroad as ${fact.verbatim}`,
      rationale:
        `The record lists ${fact.verbatim}, which the dm+d lookup resolves to ${fact.resolved}. ` +
        'Confirm the dose and the indication with the patient before prescribing, since the record carries neither.',
      consumed: [fact],
    }))
  },
}
