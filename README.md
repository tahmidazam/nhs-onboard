# NHS Onboard

Reconstructs a migrant patient's medical history from partial, foreign-language
records and hands a GP one reviewed set of actions, each traceable to the
evidence behind it.

Read [CONTEXT.md](./CONTEXT.md) for the glossary and `docs/adr/` for the
decisions. This file covers running the thing.

## Running it

```bash
npm install
cp .env.example .env.local
npm run data:fetch
npx convex dev      # terminal 1
npm run dev         # terminal 2, serves :5173
```

## Environment

Both developers use identical values for the shared block. `SIM_KEY` is the
world. Different keys mean different 50,000-patient worlds. Fill in `.env.local`
once and paste it into Discord.

Team name is the join code. The same name returns the same key and world.

```bash
curl -s https://sim.animahacks.com/api/keys \
  -H 'Content-Type: application/json' \
  -d '{"teamName":"<our team name>"}' | jq -r .apiKey
```

Server secrets also need setting on the Convex deployment.

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex env set SIM_KEY sim-...
npx convex env set SIM_ORIGIN https://sim.animahacks.com
npx convex env set VAPI_PRIVATE_KEY ...
```

Use one shared Convex dev deployment. Dev A runs `npx convex dev` first and
shares `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`. On separate deployments, Dev B
has no ingested patients to test against.

## How the work splits

The contract is `src/types.ts` and `convex/schema.ts`. Neither changes without
telling the other developer.

**Dev B takes the whole voice vertical first**, end to end, before anything else.
It is the highest-risk piece, it needs live testing time, and the brief has a
prize for the best voice-based solution. Reassess the split once it works.

| Dev B, phase 1: voice | Dev A: the pipeline |
|---|---|
| Vapi assistant in the dashboard, Bengali plus English | `convex/sim.ts`, adapter to PatientRecord |
| `convex/http.ts`, the `end-of-call-report` webhook | `convex/degrade.ts`, drop, translate, unstructure |
| `convex/call.ts`, place a call, store the transcript | `convex/extract.ts`, 4 parallel agents to Claim[] |
| `src/components/call/`, web SDK and live transcript | `convex/meds.ts`, deterministic lookup |
| Transcript to Claim[] tagged `patient-reported` | `convex/rules.ts` and `rules/*.yaml` |
| | `src/routes/board/` and `src/routes/review/` |

Dev B's first milestone is a call that connects, runs in Bengali, hangs up, and
lands a transcript in the `calls` table. Nothing else matters until that works.
Read `.claude/skills/vapi-call/SKILL.md` before starting.

Once it does, tell Dev A and we rebalance. The likely handover is the review
screen or the rule pack, whichever is further behind.

## Branches and pull requests

One branch per slice of work, named for what it does.

```
feat/vapi-webhook
feat/sim-adapter
feat/rule-pack
```

**Push to your branch every 10 to 15 minutes**, whether or not the slice is
finished. Work that only exists on one laptop is work the team can lose. Use
[Conventional Commits](https://www.conventionalcommits.org/).

```
feat(call): place an outbound call and store the transcript
fix(call): raise customerJoinTimeoutSeconds for conference wifi
chore(rules): add cervical screening rule with HPV-dependent interval
```

Open the PR when the slice runs. Both of you are heads-down, so merging does not
wait on a review: squash-merge your own PR once it works, and let the other
developer read it after. `gh pr create --fill` then `gh pr merge --squash`.

Rebase on `main` before merging so the history stays readable, and pull
straight after someone else merges.

Checkpoints. At T+1h both merge and run each other's code once. At T+2h features
freeze and only wiring continues. At T+2h30 run the demo end to end, twice.

## Architecture

```
sim -> PatientRecord -> degrader -> PresentedDocument[]
                            |               |
                   (truth retained)   4 agents, parallel
                                            |
                                        Claim[] -> meds lookup (deterministic)
                                            |            |
                                        rule pack -> Recommendation[] + Gap[]
                                            |
                              voice call (Vapi)     clinician review
                                            |            |
                                            +-> Claim[] -+-> write back to sim
```

Two model stages. The middle is deterministic.

## Conventions

**Agents.** `@openai/agents` on the Responses API. Tracing records every run in
the OpenAI dashboard. Put static content at the front of prompts and patient
content at the back so prompt caching hits.

**Prompts** live in the OpenAI dashboard as versioned objects, referenced by
`prompt: { id, version }`, so Alisha and Neil can tune them without a deploy. Pin
the version during the build. Unpin at 16:00. Zod schemas stay in code.

**Tools** are plain exported functions with a thin agent wrapper.

**Comments** state what the code does now. They do not explain why, and they do
not record history. Rationale belongs in `docs/adr/`. Write a comment only when
the code cannot carry the meaning itself.

**Prose**, in comments, docs, commits, UI copy and the submission, runs through
the `unslop` skill in `.claude/skills/unslop/`. No em dashes.

**UI.** shadcn components carry colour, typography, radius and shadow. Outside
`src/components/ui/` use layout utilities only: `flex`, `grid`, `gap-*`, `w-*`,
`max-w-*`. Muted text is `text-muted-foreground`.

Toast reports the outcome of an async action the user started. Alert states a
persistent condition next to what it describes. Dialog confirms a decision with
consequence. Sheet shows detail.

Badge variants map to the three confidence buckets and nothing else. Numbers get
`tabular-nums`. Dates render as `12 Sep 2026`. Empty states are specific
sentences. No emoji.

## Safety

Models transliterate. Datasets map. Patient assertions alone never become
prescriptions. An unresolved mapping is shown, not hidden. See
[ADR 2](docs/adr/0002-drug-mapping-is-deterministic.md) and
[ADR 3](docs/adr/0003-three-confidence-buckets.md).

All patient data is synthetic, from the Anima NHS simulator. No real patient data
is used.
