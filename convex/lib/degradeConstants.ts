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

export type LossTable = Record<'allergy' | 'medication' | 'condition' | 'immunisation', CategoryLoss>

/** The operator's dial, 0 for a pristine record and 1 for the worst the degrader produces. */
export const DEFAULT_SEVERITY = 0.5

/**
 * Scales every rate in the table by raising it to `2 * severity`.
 *
 * The exponent, rather than a multiplier, is what keeps the result a
 * probability at both ends: 0 returns 1 everywhere, so nothing is lost, and 1
 * squares each baseline into roughly twice the loss. `DEFAULT_SEVERITY`
 * returns the table below unchanged, so the shipped numbers stay the midpoint
 * a judge sees rather than an end stop.
 */
export function scaleLoss(severity: number, base: LossTable = LOSS_RATES): LossTable {
  const clamped = Math.min(1, Math.max(0, severity))
  const exponent = 2 * clamped
  const scale = (rate: number) => rate ** exponent

  return Object.fromEntries(
    Object.entries(base).map(([category, loss]) => [
      category,
      {
        survives: scale(loss.survives),
        attributes: Object.fromEntries(
          Object.entries(loss.attributes).map(([name, rate]) => [name, scale(rate)]),
        ),
      },
    ]),
  ) as LossTable
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
