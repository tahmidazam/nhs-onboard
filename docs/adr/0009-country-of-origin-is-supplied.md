# 9. Country of origin is supplied, never inferred

Date: 2026-09-12

## Status

Accepted.

## Context

The degrader cannot run until it knows where the patient came from. Country
selects the document language and the brand dataset in `src/lib/sources.ts`, so
it is an input to the first pipeline stage rather than an output of it.

The sim does not carry it. A patient item holds `id`, `name`, `birthDate`,
`conditions`, `needs`, `goals` and `localIds`. There is no country of birth, no
ethnicity and no language field anywhere in the record.

That leaves three ways to obtain it: infer it from the patient's name, derive it
from the patient id, or ask.

## Decision

`country` is a field on the patient, written by an operator control at
onboarding. It is ISO 3166-1 alpha-2, matching `PresentedDocument.country`.

Nothing infers country, ethnicity or language from a patient's name.

The field has one definition and more than one writer. A voice intake call can
set the same field without changing anything downstream.

## Consequences

Name-based inference is rejected on its merits, not on effort. A system that
guesses a patient's origin from their name will be wrong about British-born
people with foreign names and about migrants with anglicised ones, and it is the
kind of inference an NHS product should not be caught making.

Picking the country by hand is also the stronger demo. Running the same patient
as Bangladeshi, then Indian, then Ukrainian produces different documents and
different country guide citations from one pipeline.

It matches production. PRF1 has a `country_of_birth` field completed at GP
registration, so in a real deployment this is typed by a person. The control is
that form field.

PRF1 has no field for previous country of residence, only country of birth. The
country guides key on where someone lived. We carry our own field and do not
pretend the registration form supplies it.

Adding a voice intake call later is an addition, not a rewrite.
