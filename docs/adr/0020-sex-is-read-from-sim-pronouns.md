# 20. Sex is read from the sim's own pronouns

Date: 2026-09-12

## Status

Accepted. Reverses the position `CONTEXT.md` recorded under known gaps, which
rejected reading sex from the sim's narrative text and proposed an
operator-supplied control instead.

## Context

The sim carries no sex field. Verified across 240 patients, all eight site views,
six FHIR projections at `/api/nhs/pds/Patient/{id}`, the PDS capability statement
and the OpenAPI spec, which contains no occurrence of `sex` or `gender`.

The clinician screen in [ADR 21](0021-two-shells-clinician-and-operator.md) opens
with an SBAR header, and the situation line of an SBAR handover is age and sex
before anything else. Leaving it at age makes the first line of the screen read
as incomplete.

The sim does carry gendered pronouns, in `observation.text` and `encounter.text`,
consistently per patient and for some patients only: 16 female pronouns on
SIM-000001, 14 male on SIM-000002, none at all on SIM-000015. The pipeline never
saw them for a structural reason rather than a deliberate one. `patients.truth`
freezes four clinical arrays, and [ADR 10](0010-degrader-is-template-driven.md)'s
degrader assembles every document from that snapshot, so narrative prose never
reaches a PresentedDocument and cannot reach a Claim.

Two other routes were considered and rejected.

Having the degrader plant a pronoun in the clinic letter, drawn from its
per-patient seeded generator, was designed and dropped. A value from that
generator is uncorrelated with the name, so "Fatima Begum" gets a letter saying
"he has a known diagnosis" and the screen reads as broken. It was also
unnecessary, since the sim already holds the pronoun we were about to invent.

An operator control at onboarding beside
[ADR 9](0009-country-of-origin-is-supplied.md)'s country control is what
`CONTEXT.md` proposed. It puts sex outside the evidence model: a value asserted
by whoever ran onboarding, with no quote under it and nothing to check.

## Decision

Sex is captured at onboarding, where the sim view is already fetched, by a
deterministic regex in `convex/lib/sexFromText.ts` over the sim's narrative text.

It is stored on `patients.sex` with
`source: { kind: 'sim-record', id: simId, quote: <the narrative sentence> }`,
which `convex/lib/confidence.ts` already grades `document-evidenced`.

Ambiguity yields nothing. Both pronouns, or neither, leaves the field unset, and
`rules/nhs-establish-sex.ts` emits a Gap that the call settles as
`patient-reported`.

Sex is a gate, not evidence. A rule may read `profile.sex` to decide whether it
fires and must never put it in `consumed`, exactly as `country` works under ADR 9
and [ADR 15](0015-country-guides-gate-and-cite.md).

Sex is display-only for now. It reaches the SBAR header and stops there. The
three sex-gated programmes `CONTEXT.md` lists as written and unshipped, cervical,
breast and AAA, stay out of the pack.

## Consequences

Nothing is synthesised, so [ADR 1](0001-sim-is-the-source-of-truth.md) is
satisfied as written rather than narrowed. There is no
[ADR 8](0008-synthesised-immunisations-for-demo.md)-style exception to argue for,
no `synthesised` flag on sex, and no label to propagate through
`rules/engine.ts` and `src/lib/writeBack.ts`.

No model call, and no extraction. Pronoun detection is a regex over English
narrative prose, so [ADR 16](0016-extraction-is-the-only-model-stage.md) stands
untouched and extraction remains the only stage where a model reads clinical
content. Sex is also available before a document has been generated, which is
the point: the header is populated on the first screen a clinician opens.

`CONTEXT.md` argued against this, and the argument has to be stated rather than
quietly dropped. It said reading those pronouns would be name inference with
extra steps, since the sim generates the name and the narrative from one seed,
and that ADR 9's refusal to infer origin from a name applies here unchanged. The
counter-argument is that ADR 9's hazard is specific: inferring origin, ethnicity
or language from a name is a discrimination risk, and it is the inference an NHS
product should not be caught making. An explicit pronoun in a clinical document
is not an inference about the patient. It is the mechanism by which a GP actually
learns a patient's sex from a foreign record, and it arrives with a verbatim
quote a clinician can read.

The residual cost is real and narrower than the objection. Inside this simulator
the pronoun and the name do share a seed, so the quote is evidence of what the
record says and not independent evidence of the patient. On a real record it
would be neither better nor worse than any other line of narrative prose, which
is the standard the rest of the pipeline already works to.

The gate keeps the scope limit honest. A recommendation that put sex in
`consumed` would inherit its bucket and cite a sentence about pronouns as the
ground for a screening referral, which is not what that sentence says. Cervical,
breast and AAA stay out of the pack, and the reason to hold them back is now that
they are unshipped work rather than that sex is unavailable.

Coverage is partial by construction. SIM-000015 carries no pronouns, so some
patients arrive with no sex and an open Gap, and the header shows age alone until
the call runs. Resolving ambiguity to nothing rather than to a best guess is the
choice `unresolved: true` already makes under
[ADR 2](0002-drug-mapping-is-deterministic.md): a missing value is recoverable
and a wrong one is not.
