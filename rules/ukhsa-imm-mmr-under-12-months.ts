import type { ImmunisationFact, PatientProfile, Rule, RuleOutcome } from './types'

/**
 * A measles-containing dose given abroad before the first birthday does not
 * count under the UK schedule, so a record that looks immunised is not.
 *
 * The rule turns on the difference between a record that says no and a record
 * that does not say: a degraded vaccination card reading "as a child" yields no
 * `ageAtDoseMonths`, and guessing would either discount a valid dose or accept
 * an invalid one. It asks instead. See #15 and
 * docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 *
 * Source: UKHSA, vaccination of individuals with uncertain or incomplete
 * immunisation status, updated 5 June 2026, gateway 2026160, OGL v3.0.
 */

const SOURCE =
  'https://www.gov.uk/government/publications/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation-status-from-1-july-2025'

/**
 * The quoted line covers all four components, not measles alone, so the match
 * does too. A varicella-only dose before 12 months is discounted by the same
 * sentence.
 */
const MMR_COMPONENT =
  /\b(mmr|mmrv|measles|mumps|rubella|varicella|priorix|proquad|m-?m-?rvaxpro)\b/

/** The UK schedule counts a dose from the first birthday onwards. */
const FIRST_BIRTHDAY_MONTHS = 12

/** Two doses of MMR or MMRV, irrespective of infection history. */
const DOSES_REQUIRED = 2

function isMeaslesContaining(fact: ImmunisationFact): boolean {
  return MMR_COMPONENT.test(`${fact.key} ${fact.verbatim} ${fact.resolved ?? ''}`.toLowerCase())
}

/**
 * MMRV replaced MMR in the routine schedule from 1 January 2026, but the
 * algorithm branches on the patient's own date of birth, not on that date:
 * "If born before 1 January 2020, catch up MMR components using MMR."
 *
 * The cohort is derived from the frozen clock and the age in months rather than
 * from the profile's birthDate, because months are the unit every dose on a
 * card is measured in here and month precision settles a boundary six years in
 * the past.
 */
function bornFrom2020(profile: PatientProfile): boolean {
  const asOf = new Date(profile.asOf)
  const months = asOf.getUTCFullYear() * 12 + asOf.getUTCMonth() - profile.ageMonths
  return months >= 2020 * 12
}

export const rule: Rule = {
  id: 'ukhsa-imm-mmr-under-12-months',
  kind: 'immunisation',
  target: 'gp',
  priority: 2,
  countries: 'all',
  reads: 'Measles-containing doses and the age at which each was given.',
  citations: [
    {
      url: `${SOURCE}#mmr-and-mmrv-vaccination--from-first-birthday-onwards`,
      quote:
        'Doses of measles, mumps, rubella or varicella-containing vaccine given prior to 12 months of age should not be counted.',
    },
    {
      url: `${SOURCE}#mmr-and-mmrv-vaccination--from-first-birthday-onwards`,
      quote:
        'Two doses of MMR or MMRV (as appropriate for age or date of birth) should be given irrespective of history of measles, mumps, rubella or varicella infection. A minimum of 4 weeks should be left between doses.',
    },
    {
      url: `${SOURCE}#mmr-and-mmrv-vaccination--from-first-birthday-onwards`,
      quote: 'If born before 1 January 2020, catch up MMR components using MMR.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    const doses = profile.immunisations.filter(isMeaslesContaining)
    if (doses.length === 0) return []

    const outcomes: RuleOutcome[] = []

    // One gap per vague dose, numbered in profile order so two vague doses on
    // one card do not collide on a re-run.
    doses.forEach((fact, index) => {
      if (fact.ageAtDoseMonths !== undefined) return
      outcomes.push({
        kind: 'gap',
        outputKey: `${rule.id}:dose-${index + 1}:age`,
        question: `Your records show a measles-containing vaccine ("${fact.verbatim}") but not how old you were when you had it. How old were you at that dose, and was it before or after your first birthday?`,
        consumed: [fact],
      })
    })

    const dated = doses.filter((fact) => fact.ageAtDoseMonths !== undefined)
    const discounted = dated.filter(
      (fact) => (fact.ageAtDoseMonths as number) < FIRST_BIRTHDAY_MONTHS,
    )
    if (discounted.length === 0) return outcomes

    // Valid doses counted from dated doses only. A vague dose stays a question
    // rather than a pessimistic assumption, and the post-call re-run recomputes
    // this from the answer.
    const valid = dated.length - discounted.length
    const needed = DOSES_REQUIRED - valid
    if (needed <= 0) return outcomes

    const vaccine = bornFrom2020(profile) ? 'MMRV' : 'MMR'
    const timing =
      profile.ageMonths < FIRST_BIRTHDAY_MONTHS ? 'from the first birthday' : 'now'
    const ages = discounted.map((fact) => `${fact.ageAtDoseMonths} months`).join(', ')
    const doseText = needed === 1 ? '1 dose' : `${needed} doses`

    outcomes.push({
      kind: 'recommendation',
      outputKey: `${rule.id}:top-up`,
      // `text` is dropped on create_task, so the evidence travels in the title.
      title: `Measles catch-up: give ${doseText} of ${vaccine} ${timing}, minimum 4 weeks apart. Dose recorded at ${ages} does not count. UKHSA: "Doses of measles, mumps, rubella or varicella-containing vaccine given prior to 12 months of age should not be counted."`,
      rationale: `${discounted.length} recorded measles-containing dose${discounted.length === 1 ? '' : 's'} predate the first birthday and do not count under the UK schedule, leaving ${valid} of ${DOSES_REQUIRED} valid doses. Plan ${doseText} of ${vaccine}, a minimum of 4 weeks apart.`,
      consumed: dated,
    })

    return outcomes
  },
}
