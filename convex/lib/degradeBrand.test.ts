import { describe, expect, it } from 'vitest'
import { applyBrandNames } from './degradeBrand'

describe('applyBrandNames', () => {
  it('replaces a whole-word occurrence of the generic name with the local brand', () => {
    const lines = ['- Salbutamol inhaler', '- Metformin']
    const out = applyBrandNames(lines, { 'Salbutamol inhaler': 'Asthalin', Metformin: 'Glycomet' })
    expect(out).toEqual(['- Asthalin', '- Glycomet'])
  })

  it('leaves a medication with no brand match as the generic', () => {
    const lines = ['- Amoxicillin']
    const out = applyBrandNames(lines, {})
    expect(out).toEqual(['- Amoxicillin'])
  })

  it('does not touch a substring that is not a whole word', () => {
    const lines = ['- Metforminoxide']
    const out = applyBrandNames(lines, { Metformin: 'Glycomet' })
    expect(out).toEqual(['- Metforminoxide'])
  })
})
