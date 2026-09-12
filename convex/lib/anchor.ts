/**
 * Quote anchoring, per docs/adr/0017-quotes-are-anchored-by-containment.md.
 *
 * Pure: strings in, verdict out. The signature takes text rather than a Convex
 * context so `patients.truth` cannot reach it, which is what keeps the answer
 * key out of extraction and the recovery metric honest.
 */

export interface AnchorResult {
  verified: boolean
  /** Index into the original, unnormalised document text. Absent when unverified or unmappable. */
  offset?: number
}

/**
 * NFC, runs of whitespace collapsed to one space, trimmed, and nothing else.
 *
 * Deliberately not `normalise` from ../brands.ts, which lowercases and drops
 * every non-alphanumeric. That is right for a lookup key and wrong here: case
 * folding and punctuation stripping are how a false positive gets in, so ADR 17
 * refuses both.
 */
export function normaliseForAnchor(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

/**
 * Containment in two steps, both required. Step two alone proves only that the
 * quote came from the document; step one is what ties the claim to the quote,
 * and without it a model can return a genuine line with the wrong drug attached.
 *
 * Takes no offset argument by design. An offset from a model is discarded: they
 * cannot count characters, and in Bengali a grapheme, a code point and a UTF-16
 * code unit are three different numbers. Code computes it here instead.
 */
export function anchor(documentText: string, quote: string, verbatim: string): AnchorResult {
  const document = normaliseForAnchor(documentText)
  const normalisedQuote = normaliseForAnchor(quote)
  const normalisedVerbatim = normaliseForAnchor(verbatim)

  /** Empty text is contained by everything, so it would anchor anything. */
  if (!normalisedQuote || !normalisedVerbatim) return { verified: false }

  if (!normalisedQuote.includes(normalisedVerbatim)) return { verified: false }

  const at = document.indexOf(normalisedQuote)
  if (at < 0) return { verified: false }

  return { verified: true, offset: locate(documentText, at) }
}

/** One code point and the marks that follow it. Bengali writes several per syllable. */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu

/**
 * Translates an index in the normalised document back into the original text,
 * because the review UI highlights the document a clinician reads rather than
 * our normalised copy.
 *
 * The map is built cluster by cluster, so it survives a document held in NFD
 * and a character whose NFC is longer than itself, such as Bengali U+09DC. Two
 * cases return nothing rather than guessing: a rebuild that disagrees with the
 * whole-string normalisation, meaning a composition crossed a cluster boundary,
 * and a match starting part way through a cluster. A wrong offset points a
 * clinician at real text that does not support the claim, which is the silent
 * failure ADR 17 exists to refuse, and is worse than no highlight.
 */
function locate(text: string, normalisedIndex: number): number | undefined {
  const origins = new Map<number, number>()
  let built = ''

  for (const token of text.matchAll(/\S+/gu)) {
    if (built) built += ' '
    let at = token.index
    for (const cluster of token[0].match(CLUSTER) ?? []) {
      origins.set(built.length, at)
      built += cluster.normalize('NFC')
      at += cluster.length
    }
  }

  if (built !== normaliseForAnchor(text)) return undefined
  return origins.get(normalisedIndex)
}
