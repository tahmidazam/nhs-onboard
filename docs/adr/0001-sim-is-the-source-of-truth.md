# 1. The sim is the source of truth

Date: 2026-09-12

## Status

Accepted

## Context

The product onboards people arriving from other health systems. The Anima NHS
simulator holds 50,000 synthetic patients, but every record in it is a UK GP
record. None carry foreign-language documents, and patient creation is gated
behind an operator token we do not have (`/api/control/population/*` requires
`OperatorKey`). We cannot mint a patient who has just arrived from Bangladesh.

## Decision

Clinical content comes from the sim and only from the sim. The degrader takes a
real `PatientRecord` and re-presents those same facts as foreign-language
documents. It drops entries, translates them, and converts structure to prose.
It never invents a condition, a medication or a date.

The original record is retained as `patients.truth`.

## Consequences

A model sits in the test-data path, rendering sim facts into Bengali prose. The
defence against "the model made this up" is the retained answer key, shown beside
the output.

Keeping the answer key gives us `RecoveryMetric`: of 11 ground-truth facts, the
pipeline recovered 9. We can state extraction accuracy rather than assert it.

Judges pick any patient from the 50,000. Nothing is patient-specific.
