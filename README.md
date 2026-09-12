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

The contract is `src/types.ts` and `convex/schema.ts`. Dev A produces
`PresentedDocument[]`. Dev B consumes them and produces `Recommendation[]`.
Neither file changes without telling the other developer.

| Dev A, data in | Dev B, judgement out |
|---|---|
| `convex/sim.ts`, adapter to PatientRecord | `convex/extract.ts`, 4 parallel agents to Claim[] |
| `convex/degrade.ts`, drop, translate, unstructure | `convex/meds.ts`, deterministic brand lookup |
| `convex/schema.ts`, owner | `convex/rules.ts` and `rules/*.yaml` |
| `src/routes/board/`, status table | `convex/call.ts` and `convex/http.ts`, Vapi |
| `src/components/ui/`, shadcn installs | `src/routes/review/`, three confidence columns |

Both push to `main`. File ownership replaces PR review at this timescale. Run
`git pull --rebase` before every push, and commit every 10 to 15 minutes using
[Conventional Commits](https://www.conventionalcommits.org/).

```
feat(sim): normalise GP records to PatientRecord
fix(call): raise customerJoinTimeoutSeconds for conference wifi
chore(rules): add cervical screening rule with HPV-dependent interval
```

Checkpoints. At T+1h both push and run each other's code once. At T+2h features
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
