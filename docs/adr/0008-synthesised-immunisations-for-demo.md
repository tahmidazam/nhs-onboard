# 8. Immunisations and family history are synthesised for the demo

Date: 2026-09-12

## Status

Accepted. Narrows [ADR 1](0001-sim-is-the-source-of-truth.md).

## Context

ADR 1 states that clinical content comes from the sim and the degrader never
invents history.

The sim holds `problems`, `allergies`, `medications` and `miscCodes`. Verified
across 55 patients: it carries no immunisations, no family history, and no
smoking or alcohol status.

Immunisation catch-up is one of the four outputs the product exists to produce.
Dropping it removes a quarter of the thesis. Keeping it means generating data the
sim cannot supply.

## Decision

The degrader may generate a `vaccination-card` document carrying immunisations
plausible for the patient's age and country of origin, and may include family
history in a `clinic-letter`.

Every generated document sets `synthesised: true`. The UI labels it, and the
label is visible in the demo rather than buried.

Synthesised facts are excluded from `RecoveryMetric`, which measures recovery
against sim ground truth and has none for these.

Production keeps ADR 1 unchanged. Real deployment reads immunisations from the
GP record, and this path is demo scaffolding.

## Consequences

The five demo rules can include immunisation catch-up. Rules keyed on problems
and medications still fire on any judge-selected patient without scaffolding.

The label is the honesty mechanism. Saying "the simulator has no immunisation
data, so we generate a vaccination card and mark it" is a stronger answer to a
judge than a silent gap or a silent invention.

`RecoveryMetric` covers a subset of the record, so its denominator is sim facts
only.
