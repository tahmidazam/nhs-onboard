import { describe, expect, it } from 'vitest'
import { synthesiseVaccinationCard } from './degradeVaccination'

const NOW = new Date('2026-09-12').getTime()

describe('synthesiseVaccinationCard', () => {
  it('is always flagged as synthesised', () => {
    const card = synthesiseVaccinationCard('Test Patient', '1990-01-01', 'BD', 'seed-1', NOW)
    expect(card.synthesised).toBe(true)
    expect(card.kind).toBe('vaccination-card')
  })

  it('produces the same card twice for the same seed', () => {
    const first = synthesiseVaccinationCard('Test Patient', '1990-01-01', 'BD', 'seed-1', NOW)
    const second = synthesiseVaccinationCard('Test Patient', '1990-01-01', 'BD', 'seed-1', NOW)
    expect(second).toEqual(first)
  })

  it('estimates fewer vaccinations for an infant than for an adult', () => {
    const infant = synthesiseVaccinationCard('Baby Patient', '2026-06-01', 'BD', 'seed-1', NOW)
    const adult = synthesiseVaccinationCard('Adult Patient', '1980-01-01', 'BD', 'seed-1', NOW)
    const countLines = (text: string) => text.split('\n').filter((l) => l.startsWith('- ')).length
    expect(countLines(infant.text)).toBeLessThan(countLines(adult.text))
  })

  it('never claims a vaccination for an age the patient has not reached', () => {
    // A newborn cannot plausibly have a primary-school booster.
    const newborn = synthesiseVaccinationCard('Newborn', '2026-09-01', 'BD', 'seed-1', NOW)
    expect(newborn.text).not.toContain('primary school')
    expect(newborn.text).not.toContain('adolescence')
  })
})
