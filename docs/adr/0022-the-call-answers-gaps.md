# 22. The call answers gaps

Date: 2026-09-12

## Status

Accepted. Extends [ADR 16](0016-extraction-is-the-only-model-stage.md) to the
transcript, and completes [ADR 7](0007-vapi-owns-voice.md)'s
`end-of-call-report` clause.

## Context

The call produced a transcript and stopped there. `gaps.status` was only ever
written as `'open'`, `call.ingestClaims` had no callers, and
`convex/lib/adjudicate.ts` was written and wired to nothing. A patient came off
the call with the same open gaps they went in with, which is most of the product
missing.

Vapi runs its own post-call structured extraction against a schema configured in
its dashboard, and the webhook already received that field and did not parse it.

## Decision

On the end-of-call report, two narrow agents read the transcript. One returns
claims, one returns answers to the questions the assistant was given. Claims
become `patient-reported` Claims, answers mark each gap `answered` or
`unanswered`, and the rule pack re-runs.

Extraction remains the only model stage. This is extraction over a transcript
instead of a document, with the same narrow schemas and no `confidence` field,
per ADR 16. Gap selection stays code: sort by `priority`, tie-break on pack
order, take five, and now actually called.

A quote is anchored against the patient's turns only. The model is given the
whole transcript, because it needs the assistant's questions to know what a "yes"
refers to.

`gaps.status` gains `'unanswered'`, meaning asked on the call and not
established.

`calls.goals` freezes the question text beside `gapIds`. An answer resolves by
one-based index into that frozen list, never by a model reproducing an
`outputKey`.

`calls.transcriptReadAt` makes a duplicate report a no-op.

## Consequences

Anchoring against the patient's turns is structural rather than prompted, which
is what [ADR 17](0017-quotes-are-anchored-by-containment.md) asks for. The
dashboard prompt runs a verification ladder that has the assistant read drug
names and doses out loud repeatedly, so a claim quoted from an assistant readback
is our own guess laundered into the record as something the patient said. A quote
from an assistant line fails containment because the corpus it has to be
contained in does not include that line. This needed
`convex/lib/matchRecovery.ts`'s `isAnchored` fixed: its predicate admitted any
claim whose source kind was not `'document'`, so a transcript claim was anchored
unconditionally and a laundered readback would have scored as a recovered fact,
which is ADR 17's own failure mode arriving through the other door.

Our own agent over Vapi's `structuredOutputs` is a cost taken knowingly. Vapi's
runs anyway and we are already paying for the call. It was rejected because the
repo has never seen a real end-of-call-report payload, so the shape is unverified
and cannot be verified without spending shared credit, roughly 60 minutes for the
whole team. Our schema lives in the repo and runs against a stored transcript,
which is testable now and on a laptop. It is the argument ADR 6 and
`convex/lib/agents.ts` already make about prompts living in a vendor dashboard,
applied to output.

`'unanswered'` earns a schema value rather than a sentence in `answer` for three
reasons. The dashboard prompt instructs the assistant to say out loud when a
question cannot be settled, so it is an outcome the call produces deliberately.
It is ADR 3's unresolved column applied to a question rather than a claim. And
`convex/rules.ts` reconciles on `status !== 'open'`, so an `unanswered` gap
counts as decided: a re-run neither reopens it nor queues it for the next call.
Left in `answer` it would have read as open and been asked again.

Freezing `calls.goals` fixes a bug that made the rest unsound. `gapIds` and the
numbered questions were built by two different queries with nothing guaranteeing
the same list in the same order, so answer 3 could resolve against a different
gap than the one the assistant asked about. Indexing into frozen text means an
answer resolves against what the assistant was told to ask rather than against
what the database holds by the time the webhook lands.

The re-run cannot overturn a clinician. `planRows` lets a decided row claim its
`outputKey` first and never patches or deletes it, and the stage guard only moves
a patient forward. `call.complete` was writing `patients.stage` without that
guard, so a late webhook could drag an actioned patient backwards; that is fixed
too.

Two model calls per call, over a transcript, is one more place extraction can be
wrong. A wrong claim from a transcript lands in `patient-reported` and cannot
reach the prescription path under ADR 3, which is the containment already in
place for anything a patient asserts. The gap answers have no such backstop: a
gap marked `answered` from a misread transcript is a question nobody asks again,
and the only thing standing behind it is that the answer and its quote render
beside the row.
