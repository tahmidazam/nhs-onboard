# 18. Translation sits in the recovery path, matching does not

Date: 2026-09-12

## Status

Accepted. Narrows
[ADR 11](0011-recovery-is-measured-against-a-frozen-snapshot.md), which bars a
model from the scoring path without distinguishing translation from judgement.

## Context

`Claim.resolved` holds the UK term when the lookup succeeds. For medications
there is a lookup: [ADR 2](0002-drug-mapping-is-deterministic.md)'s dataset
chain, deterministic. For conditions and allergies there is no dataset and no
lookup.

ADR 11 matches conditions and allergies on normalised substring in either
direction. With `resolved` empty, matching falls back to `verbatim`, which is
Bengali. `টাইপ ২ ডায়াবেটিস` never substring-matches "Type 2 diabetes mellitus"
under any normalisation. Every condition and every allergy on every
non-English patient scores as missed, and the recovery figure reduces to
medications.

The same absence breaks the rule pack. `nhs-screen-diabetic-eye` reads diabetes
from `PatientProfile`, and it never fires on a Bengali record.

Nothing deterministic produces English from Bengali. There is no condition
equivalent of the brand datasets, and inventing one is a larger project than this
pipeline.

## Decision

The condition, allergy and immunisation agents return an `english` field: a
translation of the verbatim span and nothing else. Never a diagnosis, never a
code, never an expansion. Code writes it to `Claim.resolved`.

For medications `resolved` continues to come from the dm+d lookup. The model's
transliteration feeds that lookup and never replaces it, so ADR 2 is untouched.

The line ADR 11 draws stands as written. No model decides whether two facts mean
the same thing. The model converts language; the deterministic substring matcher
decides equivalence.

One guard on the medication path. A non-Latin brand whose transliteration
normalises to an exact dm+d VTM name is the signature of a model having
translated rather than transliterated. "নাপা" returning "Paracetamol" resolves
correctly by the wrong route and scores as a recovered medication with ADR 2's
defence silently bypassed. Reject it and mark the mapping unresolved.

## Consequences

This is the one place the metric leans on a model, and it is written down rather
than found.

`verbatim` is untouched and renders beside `resolved`, so the Bengali, the
English and the anchored line from ADR 17 sit on screen together. A judge checks
the translation the same way they check the quote.

A mistranslation usually scores as a miss, because a wrong English string is
unlikely to substring-match a truth entry. It can score as a false recovery when
the wrong string happens to name another of the same patient's conditions. That
is the residual risk, and it is bounded by the size of one patient's truth set.

The guard costs one normalised lookup per medication claim and catches the only
translation failure that moves the metric in our favour.
