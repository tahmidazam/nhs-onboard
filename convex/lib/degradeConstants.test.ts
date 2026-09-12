import { describe, expect, it } from 'vitest'
import { DEFAULT_SEVERITY, LOSS_RATES, scaleLoss } from './degradeConstants'

describe('scaleLoss', () => {
  it('leaves the shipped table alone at the default severity', () => {
    const scaled = scaleLoss(DEFAULT_SEVERITY)

    expect(scaled.condition.survives).toBeCloseTo(LOSS_RATES.condition.survives)
    expect(scaled.medication.attributes.dose).toBeCloseTo(LOSS_RATES.medication.attributes.dose)
  })

  it('loses nothing at zero, so every rate is certainty', () => {
    const scaled = scaleLoss(0)

    for (const loss of Object.values(scaled)) {
      expect(loss.survives).toBe(1)
      for (const rate of Object.values(loss.attributes)) expect(rate).toBe(1)
    }
  })

  it('drops every rate below its baseline at full severity', () => {
    const scaled = scaleLoss(1)

    expect(scaled.condition.survives).toBeLessThan(LOSS_RATES.condition.survives)
    expect(scaled.allergy.survives).toBeLessThan(LOSS_RATES.allergy.survives)
    expect(scaled.medication.survives).toBeLessThan(LOSS_RATES.medication.survives)
  })

  it('falls monotonically as severity rises', () => {
    const rates = [0, 0.25, 0.5, 0.75, 1].map((s) => scaleLoss(s).condition.survives)

    expect(rates).toEqual([...rates].sort((a, b) => b - a))
    expect(new Set(rates).size).toBe(rates.length)
  })

  it('keeps every rate a probability across the whole dial', () => {
    for (let severity = 0; severity <= 1.0001; severity += 0.05) {
      for (const loss of Object.values(scaleLoss(severity))) {
        expect(loss.survives).toBeGreaterThanOrEqual(0)
        expect(loss.survives).toBeLessThanOrEqual(1)
      }
    }
  })

  it('clamps a severity outside the dial rather than inverting the rates', () => {
    expect(scaleLoss(-1).condition.survives).toBe(scaleLoss(0).condition.survives)
    expect(scaleLoss(5).condition.survives).toBe(scaleLoss(1).condition.survives)
  })

  it('does not mutate the shipped table', () => {
    const before = LOSS_RATES.condition.survives
    scaleLoss(1)

    expect(LOSS_RATES.condition.survives).toBe(before)
  })
})
