import type { PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Orientation to the NHS for someone new to it. Fires on every patient.
 *
 * Not clinical, and in the pack on purpose. ADR 12 forbids curating the
 * patient, so a judge may nominate a 34-year-old with one condition and no
 * eligibility for anything; this rule and the primary course are what keep the
 * review screen from ever coming up empty. It is genuinely cited: the advice
 * appears on all 135 UKHSA country guides, every one of which links the NHS
 * entitlements guide.
 *
 * See docs/adr/0012-patient-selection-is-arbitrary-and-visible.md,
 * docs/adr/0015-country-guides-gate-and-cite.md and #17.
 */
export const rule: Rule = {
  id: 'ukhsa-new-arrival-orientation',
  /**
   * The sim's Action.type enum holds nothing orientation-shaped, so this lands
   * as a create_task at gp, which consumes none of the site's six bookable
   * slots. `kind` says what the action is and `target` says where it goes; this
   * is not a referral in either sense. See ADR 5's target table.
   */
  kind: 'task',
  target: 'gp',
  /** Lowest: a call has five questions in it and this rule asks none. */
  priority: 3,
  /**
   * 'all' rather than the generated 135. The advice is on every guide, and a
   * patient from a country UKHSA has not written up is still new to the NHS.
   */
  countries: 'all',
  /** Nothing. That is the point: it cannot fail to fire on a thin record. */
  confidenceFloor: 'document-evidenced',
  reads: 'Nothing about the record. Fires for every patient, which is what stops a thin record producing an empty screen.',
  citations: [
    {
      url: 'https://www.gov.uk/guidance/nhs-entitlements-migrant-health-guide',
      quote: 'explain to them how the NHS works and their entitlements to healthcare',
    },
    {
      url: 'https://www.gov.uk/guidance/nhs-entitlements-migrant-health-guide',
      quote: 'explain to new patients how the NHS operates',
    },
  ],
  evaluate(_profile: PatientProfile): RuleOutcome[] {
    return [
      {
        kind: 'recommendation',
        outputKey: 'ukhsa-new-arrival-orientation:entitlements',
        // The sim drops `text` on create_task, so what the appointment covers
        // travels here. Written by hand, not lifted from the guide row the
        // citation quotes. See ADR 15.
        title:
          'Orientation appointment: GP registration, reaching the practice in and out of hours, interpreting, and which NHS services this patient is entitled to',
        rationale:
          'New to the NHS, so nothing in the record shows the patient has been told how to reach care here. Book time at the practice to cover registration, urgent and out-of-hours routes, the right to an interpreter, and what is free at the point of use. UKHSA gives this advice on all 135 of its country guides, so it applies whoever the patient is.',
        consumed: [],
      },
    ]
  },
}
