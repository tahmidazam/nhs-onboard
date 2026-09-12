# NHS Onboard

Onboarding people who are new to the NHS, so that friction between their previous
health services and the NHS does not cost them preventive care.

Someone arrives in the UK with a partial, foreign-language medical history. GP
registration captures almost none of it. Chronic conditions go unmonitored,
immunisations are not caught up, the screening clock restarts, and medications
they were stable on abroad have no obvious UK equivalent. NHS Onboard
reconstructs that history from scanned documents and a phone call in the
patient's own language, then hands a GP one reviewed set of actions, each
traceable to the evidence behind it.

Built for the OpenAI and Anima hackathon, 12 September 2026, against the NHS
10-Year Plan shifts from sickness to prevention and from hospital to community.

## Glossary

Use these terms exactly. Do not drift to synonyms.

| Term | Meaning |
|---|---|
| **PatientRecord** | A patient as the NHS simulator holds them. Also the answer key for RecoveryMetric. |
| **PresentedDocument** | The record as a patient presents it: partial, foreign-language, unstructured. |
| **Degrader** | Turns a PatientRecord into PresentedDocument[] by dropping, translating and unstructuring. |
| **Claim** | One extracted fact, always carrying a SourceRef. Never a bare string. |
| **SourceRef** | Where a claim came from, with the verbatim quote. This is what "evidenced" means. |
| **Confidence** | One of three buckets, never a number. |
| **MedicationMapping** | Output of the deterministic brand lookup. |
| **Gap** | Something only the patient can answer. Also the voice agent's goal. |
| **Recommendation** | A proposed action with its evidence chain and its destination in the sim. |
| **RecoveryMetric** | Ground-truth facts the pipeline recovered from the degraded documents. |

### Confidence buckets

`document-evidenced` can become a draft prescription or referral.
`patient-reported` becomes a question for the clinician to confirm.
`uncertain-mapping` is shown verbatim and never actioned.

See [ADR 3](docs/adr/0003-three-confidence-buckets.md).

## Decisions

Rationale lives in `docs/adr/`. Read the ADR before changing behaviour it covers.

| ADR | Decision |
|---|---|
| [1](docs/adr/0001-sim-is-the-source-of-truth.md) | The sim is the source of truth. The degrader re-presents facts, never authors them. |
| [2](docs/adr/0002-drug-mapping-is-deterministic.md) | Drug mapping is deterministic. Models transliterate, datasets map. |
| [3](docs/adr/0003-three-confidence-buckets.md) | Three confidence buckets. Nothing is suppressed. |
| [4](docs/adr/0004-code-orchestrator.md) | The orchestrator is code. Models run at two stages only. |
| [5](docs/adr/0005-hand-encoded-rule-pack.md) | Guidelines are a hand-encoded rule pack with citations. |
| [6](docs/adr/0006-openai-agents-sdk.md) | `@openai/agents`, not the Anima ADK. |
| [7](docs/adr/0007-vapi-owns-voice.md) | Vapi owns the voice transport. |

## Data sources

All keyless, all under `data/`. `npm run data:fetch` pulls the large ones.

| File | Contents | Licence |
|---|---|---|
| `bd_medicines.csv` | 21,714 Bangladeshi brands to generics, from MEDEX | open dataset |
| `indian_medicines.csv` | 253,973 Indian brands to composition | open dataset |
| `idd.sqlite` | 425,528 international brands across 44 countries | CC BY 4.0 |
| `formulary.json` | 3,214 Cambridge and Peterborough entries with RAG status | scraped once at build time |
| `bnf.csv` | 54,437 NHSBSA BNF rows | OGL v3.0 |
| `sim.json` | NHS simulator OpenAPI spec | |

`src/lib/sources.ts` registers brand datasets per country.

The formulary site sets `robots.txt` to `Disallow: /`. Use the committed JSON. Do
not fetch it during a demo.

## Known gaps

No dataset carries Bengali-script brand strings, so "নাপা" needs a
transliteration pass before the lookup.

The formulary lists one drug across several BNF subsections with different RAG
status per indication. Key on subsection.

EDQM covers dose forms and routes in 35 languages, none of them Bengali, Hindi or
Urdu, and its API needs HMAC-SHA512 auth with an emailed credential. It never
maps drug names.
