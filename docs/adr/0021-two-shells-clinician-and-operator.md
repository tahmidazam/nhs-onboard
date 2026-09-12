# 21. Two shells, clinician and operator

Date: 2026-09-12

## Status

Accepted. Supersedes the three-column presentation clause of
[ADR 3](0003-three-confidence-buckets.md). ADR 3's substance, three buckets and
nothing suppressed, stands unchanged.

## Context

One screen served two audiences. The review screen laid recommendations out in
three columns, one per confidence bucket, beside the board, the degradation dial,
the generated documents, the extraction transcripts and the `/rules` view from
[ADR 13](0013-rules-are-typed-typescript-modules.md).

The columns come from ADR 3, which is a decision about what a clinician is told
and not about layout. Read as layout it makes evidence class the axis of the
screen. A prescription to continue and a referral to make sit in different
columns because their quotes anchored differently, and two draft prescriptions
sit apart because one of them rests on a translated line. A GP triages by what
they have to do: prescribe, refer, screen, immunise, test, record. Evidence class
is how they decide whether to do it, which is a property of a row.

The operator surfaces are instrumentation. A degradation dial and a recovery
score are how we show the pipeline works, and neither is something a clinician
would be shown.

## Decision

`/` is a clinician shell with no sidebar. A patient list, and per patient an SBAR
header over rows siloed by clinical action type, with the full evidence chain one
click away in a Sheet.

Every row carries its confidence bucket as a flag on the row. A row
`mayWriteBack` refuses still renders in its silo with the ground for the refusal,
per ADR 3 and [ADR 14](0014-rule-output-inherits-the-weakest-evidence.md).
Nothing is hidden below a threshold.

Everything operator-facing moves under `/ops`: the board, the degradation dial,
the generated documents, the extraction and recovery surfaces, and the rule pack.

`rules/ukhsa-new-arrival-orientation.ts` is deleted.

Silo colour is six new `--silo-*` tokens in `src/index.css`, defined in both
themes.

## Consequences

Moving evidence detail into a Sheet is a change in emphasis, and the cost is
direct: detail one click away is detail some users will not click. ADR 3 calls
the unresolved column the feature that makes the other two trustworthy, and a
flag on a row is quieter than a column of its own. The mitigation is that a
refused row still occupies its silo beside the actions, rather than a column a
reader can skip, so the failure a clinician cannot compensate for is the hidden
one and nothing is hidden. Whether a flag is read as reliably as a column is not
something we can claim from here.

Deleting the orientation rule drops a guarantee on purpose. It fired on every
patient regardless of record contents, which
[ADR 15](0015-country-guides-gate-and-cite.md) noted and
[ADR 12](0012-patient-selection-is-arbitrary-and-visible.md) needs, so the review
screen could never come up empty on a thin randomly selected patient. The floor
now rests on `nhs-record-condition`, `nhs-record-allergy` and
`ukhsa-imm-primary-course`, which fire on any record with content. A patient with
nothing in their record produces an empty screen, and we prefer that: an empty
clinician screen before the call and a populated one after is the demonstration
of what the call does, which a row firing on everyone was diluting. ADR 12's
thin-patient risk is now carried by the demo rather than absorbed by a rule.

Two shells is two navigations to maintain, and a demo that switches between them.
The pipeline is driven from `/ops` and the result is read at `/`, so the switch
is the story rather than an accident of routing. It is still two places to look
when something is wrong.

The six tokens exist because the UI conventions reserve the three badge variants
for the confidence buckets alone and forbid raw palette colours outside
`src/components/ui/`, so silo colour could reuse neither. Nothing checks that the
dark values track the light ones. That is by hand, and six is enough for one of
them to drift.
