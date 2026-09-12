/**
 * Per-category loss shape for the degrader. A table of numbers, no logic.
 * See docs/adr/0010-degrader-is-template-driven.md.
 */

export interface CategoryLoss {
  /** Probability the fact appears in a document at all. */
  survives: number
  /** Probability each named attribute survives, given the fact itself does. */
  attributes: Record<string, number>
}

export const LOSS_RATES = {
  /** Patients remember what they are allergic to more often than the detail of the reaction. */
  allergy: {
    survives: 0.85,
    attributes: { reaction: 0.3 },
  },
  /** The drug name outlives the dose and the frequency. */
  medication: {
    survives: 0.75,
    attributes: { dose: 0.35, frequency: 0.3 },
  },
  /** Roughly a coin flip whether it survives, and usually arrives as a symptom rather than a coded diagnosis. */
  condition: {
    survives: 0.6,
    attributes: { codedDiagnosis: 0.35 },
  },
  /** Synthesised, so this shapes the vaccination card rather than a real record. The exact date is the first thing lost. */
  immunisation: {
    survives: 0.5,
    attributes: { exactDate: 0.1 },
  },
} as const satisfies Record<'allergy' | 'medication' | 'condition' | 'immunisation', CategoryLoss>
