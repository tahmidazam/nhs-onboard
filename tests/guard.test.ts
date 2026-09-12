import { describe, expect, it } from 'vitest'
import { isLatinScript, looksTranslated } from '../convex/lib/guard'

describe('isLatinScript', () => {
  it('reads an ASCII brand as Latin', () => {
    expect(isLatinScript('Napa')).toBe(true)
  })

  it('reads a Latin brand with diacritics as Latin, composed or decomposed', () => {
    expect(isLatinScript('Ibuprofène')).toBe(true)
    expect(isLatinScript('Ibuprofène'.normalize('NFD'))).toBe(true)
  })

  it('reads Bengali as non-Latin', () => {
    expect(isLatinScript('নাপা')).toBe(false)
  })

  it('reads Cyrillic as non-Latin', () => {
    expect(isLatinScript('Но-шпа')).toBe(false)
  })

  /** A dose in Latin script does not rescue a brand written in another one. */
  it('reads a mixed-script brand and dose as non-Latin', () => {
    expect(isLatinScript('নাপা 500mg')).toBe(false)
  })

  /** Digits and punctuation carry no script, so nothing contradicts Latin here. */
  it('reads a string with no letters as Latin, so the guard cannot fire on it', () => {
    expect(isLatinScript('500')).toBe(true)
    expect(isLatinScript('')).toBe(true)
  })
})

describe('looksTranslated', () => {
  /**
   * The ADR 18 case. `নাপা` is a paracetamol brand, so the lookup succeeds
   * either way and the claim scores as recovered either way. Only the route
   * differs, and the route is the guarantee.
   */
  it('rejects Bengali নাপা transliterated as the VTM name Paracetamol', () => {
    expect(looksTranslated('নাপা', 'Paracetamol', true)).toBe(true)
  })

  it('accepts Bengali নাপা transliterated as Napa, which is no VTM name', () => {
    expect(looksTranslated('নাপা', 'Napa', false)).toBe(false)
  })

  /**
   * The case a careless guard breaks. A patient really can present a document
   * that says "Paracetamol", and rejecting it destroys a legitimate claim.
   */
  it('accepts a Latin-script Paracetamol matching the VTM name, which is legitimate', () => {
    expect(looksTranslated('Paracetamol', 'Paracetamol', true)).toBe(false)
  })

  /** ADR 2 names No-Spa: Ukrainian brand, drotaverine, no UK equivalent. */
  it('rejects Cyrillic Но-шпа transliterated to a VTM name', () => {
    expect(looksTranslated('Но-шпа', 'Hyoscine butylbromide', true)).toBe(true)
    expect(looksTranslated('Но-шпа', 'No-Spa', false)).toBe(false)
  })

  it('rejects a mixed-script brand and dose whose transliteration is a VTM name', () => {
    expect(looksTranslated('নাপা 500mg', 'Paracetamol', true)).toBe(true)
  })

  it('accepts a Latin brand with diacritics matching a VTM name', () => {
    expect(looksTranslated('Ibuprofène', 'Ibuprofen', true)).toBe(false)
  })

  /** Nothing to map, so nothing to reject. */
  it('accepts an empty transliteration', () => {
    expect(looksTranslated('নাপা', '   ', true)).toBe(false)
  })
})
