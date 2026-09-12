# 11. Recovery is measured against a frozen snapshot

Date: 2026-09-12

## Status

Accepted. Extends [ADR 8](0008-synthesised-immunisations-for-demo.md), which
already excludes synthesised facts from the denominator.

## Context

`RecoveryMetric` is the number we put in front of judges, so both of its inputs
have to survive being asked about.

The denominator moves unless we freeze it. The pipeline writes prescriptions and
referrals back to the sim, so the record changes during the demo. Measuring
against a live read means approving a recommendation alters the thing being
measured.

The numerator needs a defined match. Nothing in the record is written the same
way twice. The sim says "Type 2 diabetes mellitus" and the recovered claim says
"diabetes". A brand in a Bangladeshi prescription list is "Napa" and the UK
ingredient is "Paracetamol".

## Decision

`patients.truth` is written once at onboarding and never re-read. Live sim reads
exist only to show a written-back resource appearing in its destination site.

Matching is deterministic and specific to each category.

Medications match on the mapped UK ingredient from `MedicationMapping`, not on
the brand string. Conditions and allergies match on normalised substring in
either direction, lowercased with non-alphanumerics stripped.

No model runs in the scoring path.

Synthesised facts stay out of the denominator, per ADR 8.

## Consequences

Matching medications on `ukIngredient` scores the thing the product claims to do.
Napa resolving to Paracetamol is the mapping working, and exact string comparison
would score it zero.

The metric is explainable under questioning. "A model decides whether these mean
the same thing" is an answer that undermines an evidence-provenance pitch on the
spot.

Substring matching in either direction is generous and will occasionally accept a
loose pair. Deterministic and slightly generous beats model-judged and
unexplainable.

The denominator covers sim facts only, so the metric measures part of the record
rather than all of it. Say so on screen.
