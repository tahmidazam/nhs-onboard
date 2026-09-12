# 14. Rule output inherits the weakest evidence under it

Date: 2026-09-12

## Status

Accepted. Extends [ADR 3](0003-three-confidence-buckets.md), which buckets
claims but not the recommendations derived from them.

## Context

Every claim carries one of three buckets. A rule reads claims and emits
recommendations, and nothing said what bucket the output gets. Two cases make
the answer non-obvious.

UKHSA's governing principle fires on absence: unless there is a documented or
reliable verbal vaccine history, the patient is assumed unimmunised and a full
course is planned. That recommendation rests on no claim at all, so there is no
bucket to inherit.

And the vaccination card is synthesised, because the sim holds no immunisations
on any of its 50,000 patients. A rule reading that card produces a
recommendation resting on a fact we invented. ADR 8 keeps synthesised facts out
of the recovery denominator. It says nothing about keeping them out of a
prescription.

## Decision

Output confidence is the minimum bucket across the claims a rule consumed,
ordered `document-evidenced`, `patient-reported`, `uncertain-mapping`.

A rule consuming no claim declares a `confidenceFloor` in its metadata.
Immunisation catch-up declares `patient-reported`.

Age and sex read from the frozen snapshot are claims like any other, with
`SourceRef.kind: 'sim-record'`, and are `document-evidenced`.

Any outcome whose evidence chain touches a document with `synthesised: true`
carries `synthesised: true` itself, and renders with the label ADR 8 already
requires on the document.

No fourth bucket, and still no numbers.

## Consequences

The absence-derived recommendation cannot reach the prescription path, which is
the right outcome. "We believe you have had no vaccines" is a conversation, not
a draft.

Bowel screening at 50 rests on a birthDate from the sim, so it is evidenced and
writes back. Without that, the demo would produce only questions, and a pipeline
that asks a clinician fourteen things and does none of them is not a product.

A rule may emit a recommendation and a gap together, and usually should: plan the
course, and also ask whether a vaccination card exists at home. They are not
alternatives.

Minimum-of is pessimistic. One `uncertain-mapping` claim drags an otherwise
evidenced recommendation down a bucket. We accept that, because the alternative
is the rule author choosing, which means the bucket is set by whoever wrote the
rule rather than by the evidence under it.

Propagating `synthesised` needs the field on `recommendations` and `gaps`, not
only on `documents`.

The label is enforced at the write-back boundary, in `src/lib/writeBack.ts`.
Write-back refuses any recommendation carrying `synthesised: true` whatever its
bucket, and the review screen shows the refused row with the ground for the
refusal rather than hiding it, as ADR 3 requires. So a card-derived plan keeps
the bucket its evidence earns and still cannot reach the sim. The cost is that
the bucket no longer tells a reader on its own whether a recommendation is
writable. Anything acting on `document-evidenced` has to read the label beside
it, and that is a second thing to get right rather than one.
