# 15. Country guides gate and cite, never ground

Date: 2026-09-12

## Status

Accepted. Extends [ADR 9](0009-country-of-origin-is-supplied.md), which supplies
the country the guides key on.

## Context

`countryGuides` holds 6,992 UKHSA migrant health rows across 135 countries, 2,404
carrying citations. It is the largest guidance dataset we hold and the one least
likely to be in front of a judge twice.

The obvious use is to read a matching row and template its text into a
recommendation. 633 of the rows are about hepatitis B, which is exactly the
migrant-specific recommendation we want to make.

The rows are clinician-facing prose, not actions. "Consider screening for
hepatitis B" is guidance addressed to a reader; it names no destination, no
specimen and no interval. A recommendation whose text came out of a row is
generated, which is the thing ADR 5 exists to prevent.

## Decision

A rule declares `countries`, either `'all'` or a list of ISO 3166-1 alpha-2
codes. The list is generated at build time by a script reading `countryGuides`,
committed, with the query that produced it recorded beside it in a comment.

When a country-gated rule fires, the matched guide row is attached as a
secondary citation alongside the rule's primary one.

No recommendation text comes from a guide row.

## Consequences

Every recommendation is still hand-encoded, and the country guides make it
specific to where this patient actually came from. A hepatitis B referral for a
Bangladeshi arrival cites both the screening guidance and Bangladesh's own UKHSA
page.

Querying the guides at runtime is rejected. A 135-country match computed live is
something we cannot explain on stage and something that changes under us. A
committed list is a diff.

One of the guide sections appears on all 135 countries: the advice to explain how
the NHS works and a new arrival's entitlements. That made it available as a rule
firing on every patient regardless of record contents, which is what
`ukhsa-new-arrival-orientation` was.
[ADR 21](0021-two-shells-clinician-and-operator.md) deleted that rule: an
orientation booking is not clinical, and a GP screen is the wrong place for it.
The guide section is still cited where it gates a rule; it no longer carries one
of its own. What keeps a thin record from producing an empty screen is now the
record-condition, record-allergy and primary-immunisation rules, plus the gaps
the call exists to close, which is the reading ADR 12's own consequences take.

The committed lists go stale if UKHSA revises a guide, and nothing detects it.
The script is the remedy; re-run it.
