# 3. Three confidence buckets, and nothing is suppressed

Date: 2026-09-12

## Status

Accepted. The three-column presentation is superseded by
[ADR 21](0021-two-shells-clinician-and-operator.md); the clinician screen silos
by clinical action type and carries the bucket as a per-row flag. The decision
this ADR exists for, three named buckets and nothing suppressed, stands.

## Context

Extraction and mapping both fail silently. A confidence score tells a clinician
how sure we are but not what to do. Filtering low-confidence output produces a
clean screen that hides the cases most likely to be wrong.

## Decision

Every claim and recommendation carries one of three buckets, never a number.

`document-evidenced` can become a draft prescription or referral.
`patient-reported` becomes a question for the clinician to confirm.
`uncertain-mapping` is shown verbatim beside whatever the pipeline guessed, and
is never written back.

Nothing is hidden below a threshold.

## Consequences

Badge variants map to the buckets and to nothing else. The review UI had three
columns, one per bucket; ADR 21 replaced that axis with clinical action type and
moved the bucket onto each row, which changes where the label sits and not what
it means.

The unresolved column is the feature that makes the other two trustworthy. A
clinician can compensate for a flagged failure and cannot compensate for a hidden
one.

This also implements the main abuse defence. A patient asserting a controlled
drug on a call lands in `patient-reported` and cannot reach the prescription
path.
