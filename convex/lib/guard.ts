/**
 * The transliteration guard, per
 * docs/adr/0018-translation-sits-in-the-recovery-path.md.
 *
 * Pure: strings in, verdict out. No Convex import and no IO, so the rule is
 * asserted on data rather than on a running deployment. The dm+d read that
 * decides `latinIsVtmName` stays in convex/map.ts, where the table is readable.
 *
 * The failure it catches is the only translation failure that moves the
 * recovery metric in our favour. `নাপা` transliterates to `Napa`, which the
 * Bangladeshi dataset maps to paracetamol, which is the whole of
 * docs/adr/0002-drug-mapping-is-deterministic.md working. A model that returns
 * `Paracetamol` instead reaches the same UK ingredient by an entirely different
 * route: the lookup succeeds, the claim scores as a recovered medication, and
 * the mapping a dataset was supposed to make was made by the model. Nothing
 * about the result looks wrong, which is why this is a check and not a prompt.
 */

/**
 * Latin script, defined as: no letter from any other script.
 *
 * Only letters count. Digits, punctuation, whitespace and symbols carry no
 * script identity, so a Bengali brand written with a Latin dose, `নাপা 500mg`,
 * is non-Latin on the strength of its Bengali letters and is not rescued by the
 * `mg`. Combining marks are excluded for the mirror reason: they are
 * `Script=Inherited`, so counting them would read a decomposed `Ibuprofène` as
 * non-Latin. NFC first, for the same case.
 *
 * A string with no letters at all is Latin by this definition, which means the
 * guard cannot fire on it. That is deliberate. Rejecting a claim destroys it,
 * so the ambiguous cases resolve towards accepting.
 */
export function isLatinScript(text: string): boolean {
  const letters = text.normalize('NFC').match(/\p{L}/gu) ?? []
  return letters.every((letter) => /\p{Script=Latin}/u.test(letter))
}

/**
 * True where the transliteration looks like a translation: the source text is
 * in a non-Latin script and what came back is an exact dm+d VTM name.
 *
 * `latinIsVtmName` is the caller's, because it is a database read. The split is
 * what makes the rule testable without a deployment.
 *
 * The script test is on `verbatim` alone, and that is the load-bearing half. A
 * Latin-script `verbatim` matching a VTM name is a patient presenting a
 * document that says "Paracetamol", which is legitimate and common, and
 * rejecting it would destroy a real claim to catch nothing.
 */
export function looksTranslated(
  verbatim: string,
  latin: string,
  latinIsVtmName: boolean,
): boolean {
  if (!latinIsVtmName || !latin.trim()) return false
  return !isLatinScript(verbatim)
}
