# 16. Extraction is the only model stage

Date: 2026-09-12

## Status

Accepted. Supersedes [ADR 4](0004-code-orchestrator.md)'s two-model-stage clause
and amends its stage-transition sentence.

## Context

ADR 4 puts models at two stages: four extraction agents over each document, then
a single adjudicator deciding which gaps are worth a call.

The rule pack spec then specified the adjudicator completely. Rules declare
`priority: 1 | 2 | 3`. The cap is five gaps. Highest priority first, the
remainder stays open and visible on the review screen. It never rewrites a
question, because a question a model phrased is no longer traceable to a cited
rule.

Nothing is left for a model to decide. That is a sort and a slice. On the
shipped pack of six rules against a cap of five it usually selects everything
anyway.

Dedupe pointed the same way. Two extractions of the same fact collapse on a
normalised key, the same function ADR 11 matches with, so there is no
adjudication to do there either.

The fan-out arithmetic is a third problem. ADR 4 writes a stage transition to
`patients.stage` as each agent resolves. Four agents per document across roughly
four documents is sixteen parallel writers to one linear enum. The enum cannot
express nine of sixteen, so the writes contend and the board flickers between two
values.

## Decision

The adjudicator is code. Sort gaps by `priority`, tie-break on pack order, take
five.

Extraction is the only stage where a model touches clinical content. The
degrader's translation is bounded by ADR 10, brand mapping by ADR 2, scoring by
ADR 11, and gap selection by this.

The extraction schemas carry no field a model should not be deciding.

No `confidence`. It is determined by the source kind, whether the quote anchored
per ADR 17, and whether the brand lookup resolved. A model has no input to that
which code lacks.

No derived numerics. The immunisation agent returns the date text and never
`ageAtDoseMonths`, because the measles rule branches on whether the record *can*
say, and a model given a number field and the words "as a child" produces a
number.

Stage transitions are coarse. `extracting` is set once, `mapping` when every
agent has settled, `applying-rules` after the deterministic lookup. Live progress
on the board is the claim count, which Convex is already reactive over.

## Consequences

"Where does a model decide something?" has a one-word answer. That is worth more
on stage than the adjudicator was.

A claim counter climbing from zero to fourteen is better demo material than an
enum flicker, and it costs no schema field and no write contention.

`mapping` stays a separate stage, so reseeding a brand dataset re-runs the lookup
without re-running a model call.

Gap selection is now a pure function over declared priorities, testable beside
the rest of the pack.

Two extraction failure modes move from the model to code, where they are asserted
rather than prompted against.
