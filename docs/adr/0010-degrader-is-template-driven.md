# 10. The degrader is template-driven

Date: 2026-09-12

## Status

Accepted. Supplies the mechanism [ADR 1](0001-sim-is-the-source-of-truth.md)
asserts without one.

## Context

ADR 1 says the degrader re-presents facts and never authors them. It states the
rule but names nothing that enforces it, and the degrader is a model stage.

A model asked to write a Bengali discharge summary returns a hospital, a
consultant, a date and a dose, whether or not any of them were in the record.
That is the model working correctly. Documents have those things.

The damage is specific. The degrader's output is the input to our own extractor,
so an invented dose becomes a claim that is absent from `truth`. It cannot be
scored as recovered, and it cannot be scored as missed, because nothing was
missed. It is a fact the pipeline manufactured and then found. Left unchecked
this moves `RecoveryMetric` in the direction that flatters us.

Prompting against it does not hold. The instruction competes with the model's
correct prior that clinical documents have letterheads and dates.

## Decision

Code assembles each document from the frozen snapshot. The model translates
strings and nothing else. It never receives an instruction to write a document.

Loss is applied by code before translation, category by category. Rates live in
one constants file holding a table and no logic.

The generator is seeded from the patient id, so a given patient degrades
identically every run.

Documents persist to the `documents` table on first generation. Re-running the
pipeline reads what is stored. Re-degrading is an explicit operator action.

Non-clinical furniture may be invented freely: hospital names, letterheads,
clinic addresses, reference numbers. It is noise the extractor should ignore, and
it is what makes a document look like a document.

## Consequences

The property is structural. Clinical content cannot be hallucinated because no
model is ever asked to produce clinical content.

Translation is a narrow task on short strings, so the stage is fast and cheap,
which matters when re-running on stage.

Persisting means a repeated demo costs no model calls and no latency, and the
documents a judge saw sixty seconds ago are the documents still on screen.

Non-developers tune loss rates by editing a table. This is the same requirement
as versioned prompts in the OpenAI dashboard, applied to the deterministic half
of the pipeline.

Documents are less varied than a model writing freely would produce. That is the
trade, and it is worth it.
