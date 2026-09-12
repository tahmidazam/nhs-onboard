# NHS Onboard

Reconstructs a migrant patient's medical history from partial, foreign-language
records and hands a GP one reviewed set of actions, each traceable to the
evidence behind it.

Read [CONTEXT.md](./CONTEXT.md) for the glossary and `docs/adr/` for the
decisions. This file covers running the thing.

## Onboarding

### 1. Clone and install

This repo uses **pnpm**.

```bash
git clone https://github.com/tahmidazam/nhs-onboard && cd nhs-onboard
pnpm install
```

### 2. Install the Claude Code plugins

Three skills ship inside this repo and load on clone: `nhs-sim`, `vapi-call` and
`ui-conventions`, plus `unslop` for prose. Two more come from the official
marketplace and need installing once per machine.

```bash
claude plugin install mattpocock-skills@claude-plugins-official
claude plugin install convex@claude-plugins-official
claude plugin list
```

`mattpocock-skills` gives `/grilling`, `/domain-modeling`, `/code-review` and
`/diagnosing-bugs`. `convex` gives the Convex backend expert and reviewer.

### 3. Environment

Both developers use identical values for the shared block. `SIM_KEY` is the
world, so different keys mean different 50,000-patient worlds. One person fills
in `.env.local` and pastes the file into Discord.

```bash
cp .env.example .env.local
```

Team name is the join code. The same name returns the same key and world.

```bash
curl -s https://sim.animahacks.com/api/keys \
  -H 'Content-Type: application/json' \
  -d '{"teamName":"<our team name>"}' | jq -r .apiKey
```

Server secrets also need setting on the Convex deployment.

```bash
pnpm exec convex env set OPENAI_API_KEY sk-...
pnpm exec convex env set SIM_KEY sim-...
pnpm exec convex env set SIM_ORIGIN https://sim.animahacks.com
pnpm exec convex env set VAPI_PRIVATE_KEY ...
```

Use one shared Convex dev deployment. Dev A runs `pnpm exec convex dev` first and
shares `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`. On separate deployments, Dev B
has no ingested patients to test against.

### 4. Reference data

`data/` is gitignored. Some of it downloads, some comes from **the team Google
Drive**.

Downloads automatically:

```bash
pnpm data:fetch      # bd_medicines.csv, indian_medicines.csv, sim.json
```

Copy from Google Drive into `data/`:

| File | Why it is not fetched |
|---|---|
| `formulary.json` | The formulary site sets `robots.txt` to `Disallow: /`. Scraped once. |
| `idd.sqlite` | 51MB, built from a Mendeley spreadsheet. |
| `dmd/` | dm+d 9.0.0 from TRUD, plus the BNF zip from the dmdbonus release. |

Then build and load everything:

```bash
pnpm data:export-idd   # idd.sqlite to CSV
pnpm data:dmd          # dm+d XML to data/dmd.json
pnpm data:seed         # loads all of it into Convex
```

**One person runs `data:seed`, once.** You share a deployment, so running it
twice duplicates every row.

### 5. Run it

```bash
pnpm exec convex dev      # terminal 1
pnpm dev         # terminal 2, serves :5173
```

### 6. Read before writing code

`CONTEXT.md` holds the glossary. `docs/adr/` holds the decisions, and ADR 2 and
ADR 3 constrain the mapping and review code directly. Then take your column
below and the matching GitHub issue.

## Deployment

Every push to `main` rebuilds the live site, so the rest of the team always sees
current work without running anything.

Vercel's build command is `convex deploy --cmd 'pnpm build'`. That deploys the
Convex backend first, then builds the frontend with the production
`VITE_CONVEX_URL` already injected, so the two never drift apart.

### One-time setup

These need a browser, so run them yourself. In Claude Code, prefix with `!` to
run them in the session.

```bash
pnpm exec convex dev          # logs in, creates the dev deployment,
                              # and generates convex/_generated
```

Leave that running. It is also the local backend.

Set the secrets on the dev deployment:

```bash
pnpm exec convex env set OPENAI_API_KEY sk-...
pnpm exec convex env set SIM_KEY sim-...
pnpm exec convex env set SIM_ORIGIN https://sim.animahacks.com
pnpm exec convex env set VAPI_PRIVATE_KEY ...
```

Then Vercel:

```bash
pnpm dlx vercel login
pnpm dlx vercel link
```

In the Convex dashboard, open Settings, Deploy Keys, and generate a
**production** key. Add it to Vercel along with the browser variables:

```bash
pnpm dlx vercel env add CONVEX_DEPLOY_KEY production
pnpm dlx vercel env add VITE_VAPI_PUBLIC_KEY production
pnpm dlx vercel env add VITE_VAPI_ASSISTANT_ID production
```

Connect the GitHub repo in the Vercel dashboard so pushes to `main` deploy
automatically. Every PR also gets its own preview URL, which is the fastest way
to show someone a branch before it merges.

### Production is a separate deployment

The production Convex deployment has its own environment and its own empty
database. Set its secrets and seed it once:

```bash
pnpm exec convex env set --prod OPENAI_API_KEY sk-...
pnpm exec convex env set --prod SIM_KEY sim-...
pnpm exec convex env set --prod SIM_ORIGIN https://sim.animahacks.com
pnpm exec convex env set --prod VAPI_PRIVATE_KEY ...

VITE_CONVEX_URL=<production url> pnpm data:seed
```

Point the Vapi webhook at the production Convex HTTP URL, which is the
deployment URL with `.convex.cloud` replaced by `.convex.site`.

### Demo day

Demo from `localhost` against the dev deployment. Vite hot reload beats waiting
on a build, and a laptop on conference wifi beats a site that needs the venue's
network to reach Vercel. The deployment is for teammates and for the submission's
optional live product URL.

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

**UI.** Rules live in `.claude/skills/ui-conventions/SKILL.md`: shadcn carries
colour and typography, layout utilities only outside `src/components/ui/`, and
one job each for Toast, Alert, Dialog and Sheet.

## Safety

Models transliterate. Datasets map. Patient assertions alone never become
prescriptions. An unresolved mapping is shown, not hidden. See
[ADR 2](docs/adr/0002-drug-mapping-is-deterministic.md) and
[ADR 3](docs/adr/0003-three-confidence-buckets.md).

All patient data is synthetic, from the Anima NHS simulator. No real patient data
is used.
