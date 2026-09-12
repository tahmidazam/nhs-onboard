# NHS Onboard

Reconstructs a migrant patient's medical history from partial, foreign-language
records and hands a GP one reviewed set of actions — each traceable to the
evidence that motivated it.

Read **[CONTEXT.md](./CONTEXT.md)** first. It holds the glossary and the
decisions already made; this file is how to run the thing.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in — see "Environment" below
npm run data:fetch             # large datasets, gitignored
npx convex dev                 # terminal 1 — backend + webhook
npm run dev                    # terminal 2 — frontend on :5173
```

## Environment

**Both developers must use identical values for the shared block.** `SIM_KEY`
*is* the world — different keys mean different 50,000-patient worlds, and you
will spend twenty minutes debugging a ghost. Fill in `.env.local` once and paste
it into Discord.

Get the sim key (team name is the join code — same name, same key, same world):

```bash
curl -s https://sim.animahacks.com/api/keys \
  -H 'Content-Type: application/json' \
  -d '{"teamName":"<our team name>"}' | jq -r .apiKey
```

Server-side secrets also need setting on the Convex deployment, not just in
`.env.local`:

```bash
npx convex env set OPENAI_API_KEY sk-...
npx convex env set SIM_KEY sim-...
npx convex env set SIM_ORIGIN https://sim.animahacks.com
npx convex env set VAPI_PRIVATE_KEY ...
```

**Use one shared Convex dev deployment.** Dev A runs `npx convex dev` first and
shares `CONVEX_DEPLOYMENT` + `VITE_CONVEX_URL`. Separate deployments mean Dev B
has no ingested patients to test the engine against.

## How the work splits

The contract is **`src/types.ts`** and **`convex/schema.ts`**. Dev A produces
`PresentedDocument[]`; Dev B consumes them and produces `Recommendation[]`.
Neither file gets edited without telling the other developer out loud.

| | **Dev A — data in** | **Dev B — judgement out** |
|---|---|---|
| | `convex/sim.ts` — adapter, normalise to `PatientRecord` | `convex/extract.ts` — 4 parallel agents → `Claim[]` |
| | `convex/degrade.ts` — drop / translate / unstructure | `convex/meds.ts` — deterministic brand → UK lookup |
| | `convex/schema.ts` — **owner** | `convex/rules.ts` + `rules/*.yaml` |
| | `src/routes/board/` — status table | `convex/call.ts`, `convex/http.ts` — Vapi + webhook |
| | `src/components/ui/` — shadcn installs | `src/routes/review/` — three confidence columns |

Both push directly to `main` — at this timescale PR review costs more than file
ownership saves. `git pull --rebase` before every push. Commit every 10–15
minutes using [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sim): normalise GP records to PatientRecord
fix(call): raise customerJoinTimeoutSeconds for conference wifi
chore(rules): add cervical screening rule with HPV-dependent interval
```

**Checkpoints.** T+1h: both push, then run each other's code once. T+2h: feature
freeze — wiring and demo script only. T+2h30: full dry run, twice.

## Architecture

```
sim ──► PatientRecord ──► degrader ──► PresentedDocument[]
                              │                 │
                     (answer key kept)    ┌─────┴─────┐
                                         │  4 agents  │  parallel, narrow schemas
                                         └─────┬─────┘
                                               ▼
                                          Claim[] ──► meds lookup (DETERMINISTIC)
                                               │           │
                                               ▼           ▼
                                        rule pack ──► Recommendation[] + Gap[]
                                               │
                                     ┌─────────┴─────────┐
                                     ▼                   ▼
                              voice call (Vapi)    clinician review
                                     │                   │
                                     └──► Claim[] ───────┴──► write back to sim
                                       patient-reported       (prescription → pharmacy,
                                                               referral → referrals)
```

Two model stages, both parallel-fanned. The safety-critical middle is entirely
deterministic.

## Conventions

**Agents.** `@openai/agents` on the Responses API. Tracing is on by default, so
every run is recorded in the OpenAI dashboard — that's our audit trail. Keep
static content (rule pack, instructions) at the *front* of prompts and variable
patient content at the *back*, so prompt caching actually hits.

**Prompts live in the OpenAI dashboard**, referenced as `prompt: { id, version }`,
so non-developers can tune them without a deploy. **Pin the version during the
build**; unpin at 16:00 so they can tune live between demos. Zod schemas stay in
code — prompts are editable by anyone, the output contract is not.

**Tools are plain exported functions.** The agent wrapper is a thin layer on top.

**UI.** shadcn components carry all colour, typography, radius and shadow. Outside
`src/components/ui/` you may use layout utilities only — `flex`, `grid`, `gap-*`,
`w-*`, `max-w-*`. No `text-gray-500`, no `bg-blue-50`, no `rounded-lg`. Muted text
is `text-muted-foreground`, a token, not a colour.

- **Toast** — only the outcome of an async action the user just started.
- **Alert** — persistent in-place conditions, next to what they describe.
- **Dialog** — only a decision with consequence (approving the action set).
- **Sheet** — detail views. Never a Dialog.

Badge variants map fixed to the three confidence buckets and are used nowhere
else. Numbers get `tabular-nums`. Dates render `12 Sep 2026`. Empty states are
specific sentences, not "No data found". No emoji in the UI.

## Safety posture

Read the decisions in [CONTEXT.md](./CONTEXT.md) before touching the mapping or
recommendation path. The short version: models transliterate, datasets map,
patient assertions never become prescriptions on their own, and an unresolved
mapping is shown rather than hidden.

All patient data is synthetic, from the Anima NHS simulator. No real patient data
is used anywhere in this project.
