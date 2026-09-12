import { describe, expect, it } from 'vitest'
import { anchor, normaliseForAnchor } from '../convex/lib/anchor'

/** A PresentedDocument as the degrader leaves it: a letterhead, a line, a signature. */
const LETTER = [
  'Ashiyan Medical College Hospital',
  'Discharge summary',
  '',
  'Paracetamol 500mg three times daily',
  '',
  'Signed, Dr Rahman',
].join('\n')

/** নাপা, the Bengali brand for paracetamol. NFD and NFC are the same string here. */
const NAPA = 'নাপা'
const BENGALI_LINE = `${NAPA} ৫০০ মি.গ্রা. দিনে তিনবার`
const BENGALI_DOC = `ব্যবস্থাপত্র\n${BENGALI_LINE}\n`

/** ডোজ, "dose". U+09CB precomposed, against U+09C7 + U+09BE. */
const DOSE_COMPOSED = 'ডোজ'
const DOSE_DECOMPOSED = '\u09A1\u09C7\u09BE\u099C'

/** খাওয়ার, "after eating". U+09DF is a composition exclusion, so its NFC is longer than itself. */
const EATING_COMPOSED = '\u0996\u09BE\u0993\u09DF\u09BE\u09B0'
const EATING_DECOMPOSED = '\u0996\u09BE\u0993\u09AF\u09BC\u09BE\u09B0'

describe('normaliseForAnchor', () => {
  it('collapses whitespace and composes, and does nothing else', () => {
    expect(normaliseForAnchor('  Metformin\n\t 500 mg  ')).toBe('Metformin 500 mg')
    expect(normaliseForAnchor('Ibuprofène')).toBe('Ibuprofène')
    expect(normaliseForAnchor('Dr. RAHMAN')).toBe('Dr. RAHMAN')
  })
})

describe('anchor', () => {
  it('verifies an exact match and offsets into the original text', () => {
    const result = anchor(LETTER, 'Paracetamol 500mg three times daily', 'Paracetamol 500mg')

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(LETTER.indexOf('Paracetamol'))
    expect(LETTER.slice(result.offset)).toMatch(/^Paracetamol 500mg/)
  })

  it('verifies across NFC and NFD', () => {
    const document = 'Rx: Ibuprofène 400 mg'
    const result = anchor(document, 'Ibuprofène 400 mg', 'Ibuprofène')

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(document.indexOf('I'))
  })

  it('verifies across NFC and NFD in Bengali', () => {
    /** The fixture is only honest if the two spellings really differ. */
    expect(DOSE_COMPOSED).not.toBe(DOSE_DECOMPOSED)
    expect(DOSE_COMPOSED.normalize('NFC')).toBe(DOSE_DECOMPOSED.normalize('NFC'))

    const document = `প্রতিদিনের ${DOSE_DECOMPOSED} ৫০০ মি.গ্রা.`
    const result = anchor(document, `${DOSE_COMPOSED} ৫০০ মি.গ্রা.`, DOSE_COMPOSED)

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(document.indexOf(DOSE_DECOMPOSED))
  })

  it('offsets correctly where NFC is longer than the original character', () => {
    expect(EATING_COMPOSED).not.toBe(EATING_DECOMPOSED)
    expect(EATING_COMPOSED.normalize('NFC')).toBe(EATING_DECOMPOSED.normalize('NFC'))
    expect(EATING_COMPOSED.normalize('NFC').length).toBeGreaterThan(EATING_COMPOSED.length)

    const document = `ওষুধ ${EATING_COMPOSED} পরে`
    const result = anchor(document, `${EATING_DECOMPOSED} পরে`, EATING_DECOMPOSED)

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(document.indexOf(EATING_COMPOSED))
  })

  it('verifies across collapsed whitespace, and offsets into the original', () => {
    const document = 'Medications:\n    Metformin 500 mg\n    twice daily\n'
    const result = anchor(document, 'Metformin 500 mg twice daily', 'Metformin 500 mg')

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(document.indexOf('Metformin'))
    /** The point of the case: the normalised index would have been 13. */
    expect(result.offset).toBe(17)
  })

  it('verifies a Bengali line by containment', () => {
    const result = anchor(BENGALI_DOC, BENGALI_LINE, NAPA)

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(BENGALI_DOC.indexOf(NAPA))
  })

  it('fails a quote that is in the document but does not contain the verbatim', () => {
    expect(anchor(LETTER, 'Signed, Dr Rahman', 'Paracetamol')).toEqual({ verified: false })
  })

  it('fails a verbatim that is in the document but not inside the quote', () => {
    expect(LETTER).toContain('Dr Rahman')
    expect(anchor(LETTER, 'Paracetamol 500mg three times daily', 'Dr Rahman')).toEqual({
      verified: false,
    })
  })

  it('fails a case-only difference in the quote', () => {
    expect(anchor(LETTER, 'paracetamol 500mg three times daily', 'paracetamol')).toEqual({
      verified: false,
    })
  })

  it('fails a case-only difference in the verbatim', () => {
    expect(anchor(LETTER, 'Paracetamol 500mg three times daily', 'PARACETAMOL')).toEqual({
      verified: false,
    })
  })

  it('fails a quote that is absent from the document', () => {
    expect(anchor(LETTER, 'Amoxicillin 500mg three times daily', 'Amoxicillin')).toEqual({
      verified: false,
    })
  })

  it('fails a Bengali verbatim that is absent from the quote', () => {
    expect(anchor(BENGALI_DOC, BENGALI_LINE, 'সেকলো')).toEqual({ verified: false })
  })

  it('does not strip punctuation', () => {
    expect(anchor(BENGALI_DOC, BENGALI_LINE, 'মিগ্রা')).toEqual({ verified: false })
    expect(anchor(LETTER, 'Signed, Dr Rahman', 'Signed Dr Rahman')).toEqual({ verified: false })
  })

  it('does not strip diacritics', () => {
    expect(anchor('Rx: Ibuprofène 400 mg', 'Ibuprofene 400 mg', 'Ibuprofene')).toEqual({
      verified: false,
    })
  })

  it('fails empty text on either side, which would otherwise anchor anything', () => {
    expect(anchor(LETTER, '', '')).toEqual({ verified: false })
    expect(anchor(LETTER, 'Paracetamol 500mg', '   ')).toEqual({ verified: false })
    expect(anchor('', 'Paracetamol', 'Paracetamol')).toEqual({ verified: false })
  })

  it('returns no offset rather than a wrong one where the cluster map cannot hold', () => {
    /** Hangul L + V compose across two non-marks, which the cluster map splits. */
    const result = anchor('Dose: \u1100\u1161', '\uAC00', '\uAC00')

    expect(result.verified).toBe(true)
    expect(result.offset).toBeUndefined()
  })

  it('offsets past leading whitespace in the document', () => {
    const document = '\n\n   Metformin 500 mg'
    const result = anchor(document, 'Metformin 500 mg', 'Metformin')

    expect(result.verified).toBe(true)
    expect(result.offset).toBe(5)
  })
})
