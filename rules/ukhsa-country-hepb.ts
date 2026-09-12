import { HEPB_GUIDE_ROWS, HEPB_SCREENING_COUNTRIES } from './country-lists.generated'
import type { PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Hepatitis B serology for an arrival from a country whose UKHSA guide
 * recommends screening new arrivals.
 *
 * The migrant-specific rule in the pack, and the one ADR 15 governs: the
 * country guides gate it and cite it, and never ground it. The list below was
 * generated and committed by scripts/generate-country-lists.ts, because a
 * 135-country match computed live is something we cannot explain on stage. The
 * referral text is hand-written here; the patient's own guide rows travel as
 * secondary citations, which is the whole reason the guides are carried.
 *
 * See docs/adr/0015-country-guides-gate-and-cite.md and #17.
 */

/**
 * Serology is not one of the sim's six panels (fbc, ue, hba1c, lft, crp,
 * lipids), so this is a create_referral at referrals rather than an order_test.
 * Diagnostics also holds four capacity slots that never refill, so a test we
 * could not fulfil would 409 in front of a judge. See ADR 5's target table.
 */
export const rule: Rule = {
  id: 'ukhsa-country-hepb',
  kind: 'screening',
  target: 'referrals',
  priority: 2,
  countries: HEPB_SCREENING_COUNTRIES,
  /**
   * Country is written by an operator or a call at onboarding rather than
   * extracted from a document, so this rule consumes no Claim and takes its
   * bucket from here. See ADR 9 and ADR 14.
   */
  confidenceFloor: 'document-evidenced',
  reads: 'Country of origin, against the 98 countries whose UKHSA guide recommends screening new arrivals for hepatitis B.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/hepatitis-b-migrant-health-guide',
      quote:
        'People whose only identified risk factor for hepatitis B is country of birth should have testing offered and arranged by GPs.',
    },
    {
      url: 'https://www.gov.uk/guidance/hepatitis-b-migrant-health-guide',
      quote:
        'Diagnoses of hepatitis B virus is based on serological markers (antigens and antibodies) in plasma or serum.',
    },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    // Casing is not guaranteed: the code is typed by a person. ADR 9.
    const country = profile.country.toUpperCase()

    // The gate and the citation are the same lookup, so a country this rule
    // fires for always has a row to cite and the two cannot disagree.
    const guideRows = HEPB_GUIDE_ROWS[country]
    if (!guideRows) return []

    return [
      {
        kind: 'recommendation',
        outputKey: 'ukhsa-country-hepb:serology',
        // The sim drops `text` on create_referral, so the destination, the
        // specimen and the reason all travel here. None of it comes from a
        // guide row: a row names none of the three.
        title: `Hepatitis B serology (HBsAg), one venous blood sample: arrival from ${country}, where UKHSA advises testing new arrivals`,
        rationale: `Country of origin alone is enough to offer this: UKHSA's guide for ${country} advises testing people who have recently arrived, and testing that rests on country of birth is arranged in primary care. Serology is not one of the sim's six panels, so it goes to referrals rather than diagnostics.`,
        consumed: [],
        // ADR 15: the matched rows, verbatim, from the patient's own guide page.
        extraCitations: guideRows,
      },
    ]
  },
}
