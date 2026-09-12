# 5. Guidelines are a hand-encoded rule pack

Date: 2026-09-12

## Status

Accepted

## Context

Recommendations must cite the guidance that motivated them. We checked the
obvious sources.

NICE syndication needs an emailed application and takes weeks. The NICE UK Open
Content Licence appears to exclude AI use, though we could not read the licence
PDF directly and have not verified this. CKS and the BNF are owned by Agilio and
excluded from the NICE API. `bnf.nice.org.uk/robots.txt` disallows `ClaudeBot`
and `anthropic-ai`.

The immunisation schedule and screening programmes exist only as HTML and PDF.

## Decision

Rules live in `rules/*.yaml`, hand-encoded, each carrying a citation URL and the
quoted line it rests on. We cite by reference and do not ingest guideline text.

## Consequences

Roughly 45 rules cover the immunisation schedule and the adult screening
programmes. We ship five for the demo.

Two encoding details: MMRV replaced MMR from 1 January 2026 and an 18-month
appointment was added; cervical screening interval depends on HPV result, so
HPV-negative 25 to 49 year olds move to 5-yearly.

`order_test` in the sim accepts six panels only (`fbc`, `ue`, `hba1c`, `lft`,
`crp`, `lipids`). Rules needing anything else emit a referral.
