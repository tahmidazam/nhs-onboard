# 19. Model calls are recorded in Convex, not only in the dashboard

Date: 2026-09-12

## Status

Accepted. Narrows [ADR 6](0006-openai-agents-sdk.md), whose consequence clause
treats the SDK's dashboard tracing as covering the requirement that every stage
be recorded.

## Context

ADR 6 chose `@openai/agents` partly because tracing is on by default and records
every run in the OpenAI dashboard. That is true and it is not enough.

The dashboard is a second place to look, behind a second login, keyed by nothing
this app holds. A trace cannot be reached from a patient, a document or a claim,
because none of those ids exist in it. The question asked of the pipeline during
a review is the reverse of what the dashboard can answer: this claim, from that
document, came out of which call, and what did the model literally say before
anchoring and bucketing touched it?

The stage also loses its own inputs. `extractionFailures` records that a call
failed twice and the message it failed with. It cannot say what was sent, so a
refusal and a schema violation read the same on the patient row.

The model itself was unrecorded and unpinned. `EXTRACTION_MODEL` is unset on
every deployment, so `new Agent` fell back to whatever the installed SDK version
defaults to. The model that produced a claim was not written down anywhere in
this repo, and a dependency bump changed it with no line of this repo changing.

## Decision

Every extraction call writes one `agentRuns` row: the instructions and document
as sent, the structured output as returned, the model, the attempt count, the
duration, the token counts, and the OpenAI response id. A call that fails twice
writes the same row with its error in place of the output.

The model name is resolved in `convex/extract.ts` with `getDefaultModel()` and
passed to the agent explicitly, so the recorded name is what ran rather than an
inference about what the SDK would have picked.

Recording sits beside extraction, not inside it. The write is wrapped so that a
failed transcript cannot demote a call that returned claims into a failed one.

`begin` clears the patient's rows at the start of a run, on the same argument
that already clears `extractionFailures`: a transcript on screen belongs to the
claims on screen.

## Consequences

Sixteen rows per patient, each holding a prompt and a document. Both are
clipped at 24,000 characters against Convex's 1MB document cap, and the clip
says so in the text.

Sixteen extra writes per run, each a small mutation issued off the call's
critical path. Extraction's latency is dominated by the model, so the cost does
not land anywhere a demo notices.

Storage is not retention. These rows hold the full text of documents that stand
in for patient records, which is the same class of content as the `documents`
table they were read from, and no wider.

The recovery story gains its missing half. Recovery said what the pipeline lost;
the sheet now says which call lost it, what that call was given, and what it
returned.

The dashboard is still there, and the response id on each row is what opens the
matching trace.
