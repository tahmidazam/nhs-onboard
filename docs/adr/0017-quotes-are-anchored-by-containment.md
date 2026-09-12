# 17. Quotes are anchored by containment

Date: 2026-09-12

## Status

Accepted. Gives [ADR 3](0003-three-confidence-buckets.md)'s `document-evidenced`
a test rather than a definition.

## Context

`SourceRef.quote` is what "evidenced" means in this project. A model asked to
quote Bengali or Ukrainian text will paraphrase, transliterate or silently
translate it. This is [ADR 10](0010-degrader-is-template-driven.md)'s problem
arriving at the other end of the pipeline, and prompting against it holds no
better here than it did there.

Three mechanisms were available.

Character offsets are the worst of them. Models cannot count characters, and the
failure is worse in Bengali and Devanagari, where a grapheme, a code point and a
UTF-16 code unit are three different numbers. A wrong offset returns real text
from the document that does not support the claim, so it fails silently.

Fuzzy matching makes a threshold the definition of "evidenced", and ADR 3 already
refuses numbers.

Substring verification fails loudly, which is the property we want.

Substring-of-document is not sufficient on its own. It proves the quote came from
the document. It does not prove the claim follows from the quote, and a model can
return a genuine line with the wrong drug attached to it.

## Decision

The model returns quote text. Code verifies it and computes the offset itself. An
offset from a model is discarded.

Verification is containment in two steps. `Claim.verbatim` is a substring of
`SourceRef.quote`, and `SourceRef.quote` is a substring of the document text.

Both sides normalise to NFC with runs of whitespace collapsed, and nothing else.
No case folding and no punctuation stripping: those are how a false positive gets
in.

Verification compares against the document text only, never against
`patients.truth`, which would leak the answer key into extraction.

`SourceRef` gains `verified?: boolean`. Optional, because a ref with
`kind: 'sim-record'` has no quote to verify, and because both in-flight branches
construct refs already.

A claim that fails anchoring is demoted to `uncertain-mapping` and kept, per ADR
3. The unverified quote is retained and labelled.

An unanchored claim is excluded from the recovery numerator, under the predicate
`source.kind !== 'document' || source.verified === true`.

## Consequences

The evidence chain is structural. Document contains quote contains verbatim,
checked by code, rather than asserted by a model.

Demoting rather than dropping keeps the count honest. "Extraction proposed forty
claims and thirty-eight anchored" is a sentence we can say; dropping makes the
failure unobservable, which is the thing ADR 3 exists to prevent.

Excluding unanchored claims from the numerator is the point of the flag. Without
it a hallucinated claim scores as a recovered fact, which is ADR 10's failure
mode arriving at the metric.

`verified` is optional and additive, so the onboarding and rule pack branches
take it without a change to either.

The predicate lives at `matchRecovery`'s call site, because that function belongs
to a branch in flight. It moves inside the function once the branches merge, so
the invariant ends up with the metric rather than with its caller.
