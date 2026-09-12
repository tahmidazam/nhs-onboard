# 12. Patient selection is arbitrary and visible

Date: 2026-09-12

## Status

Accepted.

## Context

Judging requires selecting any arbitrary patient from the sim and running the
full pipeline on them. How that selection is surfaced either proves the claim or
quietly avoids it.

The sim holds 50,000 patients. `/patients` takes a `q` search, returns
`{ items, total }`, pages at 30, and offsets only.

A shortlist of patients we tested earlier is the first thing a sceptical judge
will suspect, which means building one costs us the point it was meant to win.

## Decision

The board offers a random pick and a search. There is no curated list.

Selection shows the patient's record size before onboarding starts. Re-rolling is
an operator action taken in view of whoever is watching.

Nothing filters candidates by record contents.

## Consequences

Random selection is proof that survives a sceptic. Search exists because a judge
may want to pick someone themselves, which is a stronger version of the same
claim.

Random selection can land on a patient with one condition and no medications, and
that demo is thin. Showing record size first, and re-rolling openly, is the
mitigation. Visible re-rolling reads as confidence. Silent filtering is the thing
that would actually be cheating.

A thin patient is a real case rather than a broken one. Nothing to extract means
everything becomes a gap, and gaps are what the voice call exists to close.
