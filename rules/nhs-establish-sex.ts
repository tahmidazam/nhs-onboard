import type { PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Asks the patient's sex when nothing has established it.
 *
 * The sim carries no sex field, verified across the patient item, all six FHIR
 * projections and the OpenAPI spec. `patients.sex` is what ADR 20 read out of
 * the gendered pronouns in the sim's own narrative text at onboarding, by the
 * regex in convex/lib/sexFromText.ts, or what an earlier call settled.
 *
 * ADR 20 resolves ambiguity to nothing: both pronouns, or neither, leaves the
 * field unset, and this rule is the Gap it names for that case. So it fires on
 * a patient like SIM-000015, whose narrative carries no pronoun at all, and on
 * nobody else. That is a real case rather than a broken one, and ADR 12 forbids
 * curating those patients out of the demo.
 *
 * Priority 1 because it gates other questions rather than answering one.
 * docs/vapi-system-prompt.md's step 11 offers screening by age and sex, and
 * says outright that where the record holds no sex the screening offered
 * follows from the answer given on the call. Asked late, the answer arrives
 * after the screening questions it decides.
 *
 * `consumed: []` because sex is a gate and not evidence, exactly as `country`
 * is under ADR 9. It is not in `truth`, and it carries its own bucket and
 * SourceRef on the patient row rather than travelling as a ProfileFact. ADR 20
 * gives the reason to keep it off `consumed`: an outcome consuming it would
 * inherit its bucket and cite a sentence about pronouns as the ground for a
 * clinical action, which is not what that sentence says.
 *
 * It declares no `confidenceFloor` either, and not by omission: ADR 14's floor
 * exists so a recommendation that consumed no fact still has a bucket, and
 * rules/engine.ts reads it only after returning for `kind: 'gap'`. A gap
 * derives no bucket at all, so a floor here would be a value nothing reads,
 * shown on /rules under a caption about inheriting from claims.
 *
 * We do not synthesise the answer. ADR 8 synthesises immunisations because the
 * alternative was abandoning catch-up entirely; here the alternative is one
 * question on a call we are already making, and ADR 20 turns it down for the
 * further reason that a pronoun drawn from our own seeded generator is
 * uncorrelated with the patient's name and reads on screen as a broken record.
 */

export const rule: Rule = {
  id: 'nhs-establish-sex',
  /**
   * Gap-only, so the engine reads neither field. They say where the answer
   * lands: onto the patient's record at the practice. Not `task`, which
   * nothing in the pack emits and src/lib/buckets.ts maps to no silo.
   */
  kind: 'problem',
  target: 'gp',
  priority: 1,
  countries: 'all',
  reads:
    'Whether anything has established the patient\'s sex: a pronoun read back out of the sim\'s narrative text at onboarding, or an answer from an earlier call. Never the name, which ADR 9 refuses to infer from.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/assessing-new-patients-from-overseas-migrant-health-guide',
      quote: 'Offer migrants the same basic new patient check as for all registering patients.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    if (profile.sex !== undefined) return []

    return [
      {
        kind: 'gap',
        outputKey: 'nhs-establish-sex:sex',
        // Says why it is being asked, because a demographic question out of
        // nowhere reads as a data grab on a call the patient did not request.
        question:
          'The records we were sent do not say whether you are male or female, and some of the checks the NHS offers depend on it. Which should we put on your record?',
        consumed: [],
      },
    ]
  },
}
