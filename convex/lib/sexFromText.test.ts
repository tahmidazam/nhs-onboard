import { describe, expect, it } from 'vitest'
import { sexFromText } from './sexFromText'
import { anchor } from './anchor'

/**
 * The simulator's own narrative shape, as `encounter.text` writes it. The
 * pronoun-free line is SIM-000015's verbatim, which is the case CONTEXT.md
 * records as a patient with no pronouns at all.
 */
const NO_PRONOUN =
  'Fictional consultation. The patient discussed their next appointment and contact preferences.'
const FEMALE_NARRATIVE =
  'Fictional consultation. She discussed her next appointment and contact preferences.'
const MALE_NARRATIVE =
  'Fictional consultation. He discussed his next appointment and contact preferences.'

describe('sexFromText', () => {
  it('reads a female pronoun and quotes the sentence carrying it', () => {
    expect(sexFromText(FEMALE_NARRATIVE)).toEqual({
      value: 'female',
      quote: 'She discussed her next appointment and contact preferences.',
    })
  })

  it('reads a male pronoun and quotes the sentence carrying it', () => {
    expect(sexFromText(MALE_NARRATIVE)).toEqual({
      value: 'male',
      quote: 'He discussed his next appointment and contact preferences.',
    })
  })

  it('returns nothing for the narrative the sim writes without pronouns', () => {
    expect(sexFromText(NO_PRONOUN)).toBeUndefined()
  })

  it('returns nothing for empty text', () => {
    expect(sexFromText('')).toBeUndefined()
  })

  it('reads each of the six forms', () => {
    const forms: [string, 'male' | 'female'][] = [
      ['She attended clinic.', 'female'],
      ['The nurse reviewed her notes.', 'female'],
      ['The record is hers.', 'female'],
      ['He attended clinic.', 'male'],
      ['The nurse reviewed him.', 'male'],
      ['The nurse reviewed his notes.', 'male'],
    ]
    for (const [text, value] of forms) expect(sexFromText(text)?.value).toBe(value)
  })

  it('is case insensitive, since a narrative may shout', () => {
    expect(sexFromText('SHE ATTENDED CLINIC.')?.value).toBe('female')
  })

  /* ---------------------------------------------------------------------- */
  /* Ambiguity is an answer. See ADR 3 and ADR 20.                           */
  /* ---------------------------------------------------------------------- */

  it('returns nothing when both sexes appear, rather than taking the first', () => {
    expect(
      sexFromText('She attended with her son. He waited outside.'),
    ).toBeUndefined()
  })

  it('returns nothing when the two pronouns share one sentence', () => {
    expect(sexFromText('His daughter said she would call back.')).toBeUndefined()
  })

  /* ---------------------------------------------------------------------- */
  /* Word boundaries. Each of these substrings is a pronoun and none is.     */
  /* ---------------------------------------------------------------------- */

  it('does not match a pronoun inside a longer word', () => {
    const traps = [
      'The history was reviewed at the clinic.',
      'Other findings were normal.',
      'Sheila attended with the patient.',
      'The patient was seen by Dr Herring.',
      'Theatre list confirmed.',
      'Adherence was discussed.',
      'Shed loads of notes were scanned.',
      'Hepatitis B immunity was checked.',
    ]
    for (const trap of traps) expect(sexFromText(trap)).toBeUndefined()
  })

  it('does not match a pronoun running into a digit', () => {
    expect(sexFromText('HER2 receptor status was negative.')).toBeUndefined()
  })

  it('does match a pronoun beside punctuation', () => {
    expect(sexFromText("The clinic confirmed she's booked.")?.value).toBe('female')
    expect(sexFromText('(He attended alone.)')?.value).toBe('male')
  })

  /* ---------------------------------------------------------------------- */
  /* Names, which is the objection ADR 9 raises and ADR 20 has to answer.    */
  /* ---------------------------------------------------------------------- */

  it('does not read sex off a name in a labelled field line', () => {
    const document = ['Patient: He Xiaoming', 'Date of birth: 1980-01-01'].join('\n')
    expect(sexFromText(document)).toBeUndefined()
  })

  it('still reads the prose around a name that looks like a pronoun', () => {
    const document = ['Patient: He Xiaoming', '', 'She attended clinic alone.'].join('\n')
    expect(sexFromText(document)?.value).toBe('female')
  })

  it('does not treat a clinical sentence with a colon as a field line', () => {
    expect(sexFromText('Allergic to Penicillin, reaction: rash. She tolerated the alternative.')?.value).toBe(
      'female',
    )
  })

  /* ---------------------------------------------------------------------- */
  /* The quote, which is what makes the value checkable.                     */
  /* ---------------------------------------------------------------------- */

  it('quotes one sentence rather than the whole text', () => {
    const text = 'The patient was reviewed. She reported no new symptoms. The plan is unchanged.'
    expect(sexFromText(text)?.quote).toBe('She reported no new symptoms.')
  })

  it('quotes across lines by taking the line the pronoun is on', () => {
    const text = ['Fictional consultation.', 'Contact preference recorded.', 'She prefers telephone.'].join('\n')
    expect(sexFromText(text)?.quote).toBe('She prefers telephone.')
  })

  it('keeps a question or an exclamation with its sentence', () => {
    expect(sexFromText('Does she attend alone? The record says yes.')?.quote).toBe('Does she attend alone?')
  })

  it('quotes a trailing sentence that has no terminator', () => {
    expect(sexFromText('Reviewed in clinic. She is well')?.quote).toBe('She is well')
  })

  it('returns a quote that is a verbatim substring of the text it was read from', () => {
    for (const text of [FEMALE_NARRATIVE, MALE_NARRATIVE, 'Reviewed. She is well. Discharged.']) {
      const read = sexFromText(text)
      expect(read).toBeDefined()
      expect(text.includes(read!.quote)).toBe(true)
    }
  })

  /**
   * ADR 17's containment, run over the quote this module produces. A sentence
   * sliced out of the text anchors against that text, which is what lets the
   * value be checked rather than trusted.
   */
  it('produces a quote that anchors by containment', () => {
    const read = sexFromText(FEMALE_NARRATIVE)
    expect(anchor(FEMALE_NARRATIVE, read!.quote, read!.quote).verified).toBe(true)
  })

  /* ---------------------------------------------------------------------- */
  /* The sentences the degrader's clinic letter emits. See ADR 20.           */
  /* ---------------------------------------------------------------------- */

  it('reads back the third-person forms convex/lib/degradeRecord.ts renders', () => {
    const sentences: [string, 'male' | 'female'][] = [
      ['She has a known diagnosis of Asthma.', 'female'],
      ['He has a known diagnosis of Asthma.', 'male'],
      ['She describes ongoing issues consistent with Type 2 diabetes mellitus.', 'female'],
      ['He describes ongoing issues consistent with Type 2 diabetes mellitus.', 'male'],
      ['Please contact the clinic if she requires a copy of her records.', 'female'],
      ['Please contact the clinic if he requires a copy of his records.', 'male'],
    ]
    for (const [sentence, value] of sentences) {
      expect(sexFromText(sentence)).toEqual({ value, quote: sentence })
    }
  })

  it('is not confused by the pronoun-free forms the same letter renders', () => {
    const sentences = [
      'Known diagnosis: Asthma.',
      'Patient describes ongoing issues consistent with Hypertension.',
      'Patient could not recall any known drug allergies.',
      'No further history recorded at this visit.',
    ]
    for (const sentence of sentences) expect(sexFromText(sentence)).toBeUndefined()
  })
})
