/**
 * Reads sex out of narrative text by its pronouns. Pure: a string in, a value
 * and the sentence it rests on out. No fetching, no database access, no model
 * call. See docs/adr/0020-sex-is-read-from-sim-pronouns.md.
 *
 * The input is the simulator's own narrative, `encounter.text` and
 * `observation.text`, which the sim writes with gendered pronouns for some
 * patients and not others. Nothing here invents anything, so nothing this
 * produces is synthesised, and the sentence travels with the value as its
 * quote: an explicit pronoun in a clinical record is how a GP actually learns
 * a patient's sex from a foreign record, and it is checkable.
 *
 * Not a model call, and that is a decision rather than an omission. ADR 16
 * makes extraction the only stage where a model touches content, on the
 * argument that a model should decide nothing code already knows. Pronoun
 * detection is six tokens and a word boundary. An agent here would cost a
 * call, a retry path and a recorded run, and would return a `value` we could
 * not check, in exchange for nothing this file cannot do exactly.
 *
 * Ambiguity is an answer. Both sexes present, or neither, returns undefined,
 * and the caller leaves `patients.sex` unset so a rule can raise it as a Gap
 * for the call. Guessing between two pronouns would be the failure ADR 3
 * exists to prevent, arriving on the one field with no answer key behind it.
 */

export interface SexFromText {
  value: 'male' | 'female'
  /** Verbatim substring of the input: the sentence the pronoun sits in. */
  quote: string
}

/**
 * The six subject, object and possessive forms.
 *
 * `\b` on both sides is the whole safety margin, and it is doing more work than
 * it looks. "he" sits inside "the", "other" and "Sheila"; "her" inside
 * "Herring" and "HER2"; "his" inside "history", which a clinical narrative
 * says constantly. A boundary on each side rejects every one of them.
 */
const PRONOUN = /\b(?:she|her|hers|he|him|his)\b/giu

const FEMALE = new Set(['she', 'her', 'hers'])

/**
 * A labelled field line, e.g. "Patient: ...", "Reference: ...", "Date of
 * birth: ...". Skipped wholesale, because a field line carries identifiers
 * rather than prose and a patient's name is the one place a pronoun-shaped
 * token appears without being a pronoun: "Patient: He Xiaoming" is a surname,
 * and reading sex off it would be the name inference ADR 9 refuses, which is
 * the objection ADR 20 has to answer rather than walk into.
 *
 * The label is short, alphabetic and comma-free, so it matches a heading and
 * not a clinical sentence that happens to contain a colon, such as
 * "Allergic to Penicillin, reaction: rash."
 */
const FIELD_LINE = /^\s*[A-Za-z][A-Za-z ()/-]{0,24}:/

/** One sentence, terminator included. A line with no terminator is one sentence. */
const SENTENCE = /[^.!?]+[.!?]*/g

/** Trimmed sentences of one line, in order. Each is a substring of the input. */
function sentencesOf(line: string): string[] {
  return [...line.matchAll(SENTENCE)].map((match) => match[0].trim()).filter(Boolean)
}

/**
 * The first pronoun's sentence, or undefined.
 *
 * Every match in the text is read before anything is returned, because the
 * disagreement case is the one worth catching: a narrative naming a patient
 * and their mother carries both sexes, and the first pronoun in it is evidence
 * of nothing.
 */
export function sexFromText(text: string): SexFromText | undefined {
  const seen = new Set<'male' | 'female'>()
  let first: SexFromText | undefined

  for (const line of text.split('\n')) {
    if (FIELD_LINE.test(line)) continue

    for (const sentence of sentencesOf(line)) {
      for (const match of sentence.matchAll(PRONOUN)) {
        const value = FEMALE.has(match[0].toLowerCase()) ? 'female' : 'male'
        seen.add(value)
        if (!first) first = { value, quote: sentence }
      }
    }
  }

  if (seen.size !== 1 || !first) return undefined
  return first
}
