# 13. Rules are typed TypeScript modules

Date: 2026-09-12

## Status

Accepted. Supersedes the storage clause of
[ADR 5](0005-hand-encoded-rule-pack.md), whose decision to cite by reference and
never ingest guideline text stands unchanged.

## Context

ADR 5 said rules live in `rules/*.yaml`. That was written before we read the
source.

The UKHSA uncertain or incomplete immunisation status algorithm is not a lookup
table. It sets four age bands with three-dose ladders at four-week intervals,
then qualifies them: a measles-containing dose given before 12 months does not
count, OPV given abroad since April 2016 is discounted, PCV10 abroad needs one
PCV13 top-up, and a started course resumes rather than restarts. That is
arithmetic over dated events, with exceptions.

A YAML dialect expressive enough to state it is a programming language with no
type checker, designed in an afternoon and debugged at two in the morning. The
screening programmes would fit in YAML comfortably. The half of the pack that
makes this project interesting would not.

The argument for YAML was legibility: a rule pack should be readable by someone
who is not reading code.

## Decision

Each rule is a TypeScript module under `rules/`, exporting one `Rule`. Metadata
is declarative: `id`, `kind`, `target`, `citations`, `confidenceFloor`,
`countries`, `priority`. Behaviour is one function, `evaluate(profile)`,
returning `RuleOutcome[]`.

`citations` is typed `[Citation, ...Citation[]]`, so a rule carrying none does
not compile. A test fails the build on any citation URL under `cks.nice.org.uk`
or `bnf.nice.org.uk`.

`rules/` imports nothing from Convex and performs no IO. `rules/engine.ts`
exports `applyRules(profile, pack)`, pure. `convex/rules.ts` reads, writes and
advances the stage around it, per the pattern set in #6.

Legibility comes from a generated `/rules` view rendering each rule's metadata
and quoted lines, not from the storage format.

## Consequences

`tsc` checks the pack. A rule referring to a profile field that does not exist
fails at build rather than returning nothing at runtime, which is the failure
mode we cannot afford: a rule that silently never fires looks identical to a
patient who is not eligible.

Rule ids are semantic and kebab-case, namespaced by source:
`ukhsa-imm-primary-course`, `nhs-screen-bowel`. They appear in `gaps.ruleId` and
in the voice agent's goal, where `ukhsa-imm-mmr-under-12-months` is
self-documenting in a transcript and `UKHSA-IMM-004` is not. A test asserts ids
are unique, because a renamed id orphans gap rows.

Evaluation is order-independent and no rule suppresses another. Two rules firing
on one patient means their conditions are too broad, and the fix is narrowing a
condition rather than adding a precedence graph we would then have to explain.
Duplicate outputs are deduplicated by `outputKey` alone.

The pack is no longer editable by a non-developer. For a rule set encoding
dose-interval arithmetic, it never really was.
