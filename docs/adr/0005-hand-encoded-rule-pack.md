# 5. Guidelines are a hand-encoded rule pack

Date: 2026-09-12

## Status

Accepted. The storage clause is superseded by
[ADR 13](0013-rules-are-typed-typescript-modules.md); rules are typed TypeScript
modules, not YAML. The decision this ADR exists for, to cite by reference and
never ingest guideline text, stands.

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

Eleven rules ship. Five produce clinical actions: immunisation catch-up from
absent history, measles-containing dose validity, bowel screening, diabetic eye
screening, and country-gated hepatitis B screening. Three reconstruct history
onto the UK record: continue a medication, record a condition, record an
allergy. Three exist to fill a call:
`nhs-ask-allergies` whenever no allergy survived,
`nhs-establish-sex` whenever the record carried no pronoun
([ADR 20](0020-sex-is-read-from-sim-pronouns.md)), and
`nhs-general-history` for whichever sections of the record say nothing.

New arrival orientation was in this list and was deleted by
[ADR 21](0021-two-shells-clinician-and-operator.md): an orientation booking is
not clinical, and a GP screen is the wrong place for it.

`CONTEXT.md` names the programmes not covered. We do not claim a total the pack
does not contain.

Two encoding details: MMRV replaced MMR from 1 January 2026 and an 18-month
appointment was added; cervical screening interval depends on HPV result, so
HPV-negative 25 to 49 year olds move to 5-yearly.

The MMRV date is about the routine programme and is not the boundary a catch-up
rule branches on. The UKHSA algorithm keys on the patient's date of birth,
before or on or after 1 January 2020, and `ukhsa-imm-mmr-under-12-months`
encodes 2020 accordingly. Verified against the 5 June 2026 edition while
encoding #15.

`order_test` in the sim accepts six panels only (`fbc`, `ue`, `hba1c`, `lft`,
`crp`, `lipids`). Rules needing anything else emit a referral.
