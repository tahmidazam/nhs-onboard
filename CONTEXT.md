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
| **Rule** | One hand-encoded piece of guidance: declarative metadata plus an `evaluate` function. |
| **RulePack** | The ordered set of Rules the engine runs. |
| **PatientProfile** | The normalised projection a Rule reads. Rules never read Claims directly. |
| **RuleOutcome** | What a Rule emits: a Recommendation, a Gap, or nothing. |
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
| [8](docs/adr/0008-synthesised-immunisations-for-demo.md) | Immunisations and family history are synthesised for the demo and labelled. |
| [9](docs/adr/0009-country-of-origin-is-supplied.md) | Country of origin is supplied by an operator or a call. Never inferred from a name. |
| [10](docs/adr/0010-degrader-is-template-driven.md) | The degrader is template-driven. Code assembles documents, the model only translates. |
| [11](docs/adr/0011-recovery-is-measured-against-a-frozen-snapshot.md) | Recovery is measured against a frozen snapshot with deterministic matching. |
| [12](docs/adr/0012-patient-selection-is-arbitrary-and-visible.md) | Patient selection is random or searched, never curated. |
| [13](docs/adr/0013-rules-are-typed-typescript-modules.md) | Rules are typed TypeScript modules. Supersedes ADR 5's YAML clause. |
| [14](docs/adr/0014-rule-output-inherits-the-weakest-evidence.md) | A rule's output inherits the weakest evidence under it. |
| [15](docs/adr/0015-country-guides-gate-and-cite.md) | Country guides gate a rule and cite it. They never ground it. |

## Data sources

All keyless, all under `data/`. `pnpm data:fetch` pulls the large ones.

| File | Contents | Licence |
|---|---|---|
| `bd_medicines.csv` | 21,714 Bangladeshi brands to generics, from MEDEX | open dataset |
| `indian_medicines.csv` | 253,973 Indian brands to composition | open dataset |
| `idd.sqlite` | 425,528 international brands across 44 countries | CC BY 4.0 |
| `formulary.json` | 3,214 Cambridge and Peterborough entries with RAG status | scraped once at build time |
| `bnf.csv` | 54,437 NHSBSA BNF rows | OGL v3.0 |
| `sim.json` | NHS simulator OpenAPI spec | |
| `country-guides.json` | 6,992 UKHSA migrant health recommendations across 135 countries, 2,404 with citations | OGL v3.0 |
| `dmd.json` | 3,248 UK ingredients with prescribable product, BNF and ATC codes | OGL |

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

The sim carries no sex or gender. It is absent from patient items and from the
FHIR projection at `/api/nhs/pds/Patient/{id}`. Cervical, breast and AAA
screening are sex-gated, so they emit a Gap for the call rather than a
Recommendation, and none of them is in the shipped pack. We do not synthesise
sex: ADR 8 synthesises immunisations because the alternative was abandoning
catch-up entirely, and here the alternative is a question on a call we are
already making.

The rule pack covers six programmes. Not covered: cervical, breast, AAA,
newborn blood spot, newborn hearing, NIPE, antenatal and newborn sickle cell,
antenatal infectious disease, and the remainder of the routine immunisation
schedule beyond measles-containing dose validity. NIPE has no catch-up route at
all, because it is scoped to babies born in England, so a family arriving with a
two-week-old falls through a gap in the programme rather than a gap in our data.

The sim's problem list carries `status`, either `active` or `resolved`, but the
patient search item flattens both into one `conditions` array. Rules keying on a
condition read the active set. A degraded document does not record resolution
either, so a resolved condition can present as current. That is what a real
migrating record does, and we do not correct for it.
