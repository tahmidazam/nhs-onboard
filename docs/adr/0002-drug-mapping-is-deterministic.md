# 2. Drug mapping is deterministic

Date: 2026-09-12

## Status

Accepted

## Context

Mapping a foreign brand name to a UK medicine is the core of the product and the
place where a wrong answer harms a patient.

We tested RxNav's `approximateTerm` against 20 real foreign brands. It did not
fail loudly. It returned different real drugs, with confidence:

| Input | Returned | Correct |
|---|---|---|
| No-Spa (UA) | hyoscyamine | drotaverine |
| Analgin (RU) | paracetamol | metamizole |
| Crocin (IN) | crocin, the carotenoid, score 15.9 | paracetamol |

The highest-scoring match was among the wrong ones. A language model asked to do
this from memory fails the same way with more fluency.

## Decision

Brand resolution runs as a plain function over static datasets, in this order:
country dataset, then IDD, then RxNav exact, then RxNav `approximateTerm` with a
score floor. A model never selects the mapping.

Models handle script transliteration only. Bengali script reaches the lookup as
Latin text, and the lookup does the rest.

`unresolved: true` is a valid result. "No UK equivalent" is correct for
metamizole and drotaverine, which are not UK-licensed.

## Consequences

Coverage is bounded by the datasets in `src/lib/sources.ts`. Adding a country is
one row.

Verified end to end: Napa maps to Paracetamol [Green], Seclo to Omeprazole with
oral [Green] and IV [Red Hospital] split by form.

The mapping cannot be exposed as an agent tool without reintroducing the failure
mode, so tools stay plain functions with a thin agent wrapper.
