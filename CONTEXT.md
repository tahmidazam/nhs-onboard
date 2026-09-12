# NHS Onboard

Onboarding people who are new to the NHS — long-term immigrants, asylum seekers,
refugees — so that friction between their previous health services and the NHS
doesn't cost them preventive care.

Built for the OpenAI × Anima hackathon, 12 September 2026. Addresses the NHS
10-Year Plan's *sickness to prevention* and *hospital to community* shifts.

## The problem in one paragraph

Someone arrives in the UK with a partial, foreign-language medical history. The
GP registration process captures almost none of it. Their chronic conditions go
unmonitored, their immunisations aren't caught up, their screening clock starts
from scratch, and the medications they were stable on abroad have no obvious UK
equivalent. Ten years later this presents as preventable disease. NHS Onboard
reconstructs that history from whatever the patient can provide — scanned
documents, a phone call in their own language — and hands a GP a single reviewed
set of actions, each one traceable to the evidence that motivated it.

## Glossary

Use these terms exactly. Don't drift to synonyms.

| Term | Meaning |
|---|---|
| **PatientRecord** | A patient as the NHS simulator holds them. Ground truth, and our evaluation answer key. |
| **PresentedDocument** | The record as a patient actually presents it: partial, foreign-language, unstructured. Produced by the degrader. |
| **Degrader** | Turns a `PatientRecord` into `PresentedDocument[]` by dropping, translating and unstructuring. Simulates arrival from abroad. |
| **Claim** | One extracted fact, always carrying a `SourceRef`. Never a bare string. |
| **SourceRef** | Where a claim came from — document, transcript or sim record — with the verbatim quote. This is what "evidenced" means. |
| **Confidence** | One of three buckets, never a number. See below. |
| **MedicationMapping** | Result of the *deterministic* foreign-brand → UK lookup. No model involved. |
| **Gap** | Something the record can't tell us that a call or chat could resolve. Doubles as the voice agent's goal. |
| **Recommendation** | A proposed action with its evidence chain and its destination in the sim. |
| **RecoveryMetric** | How many ground-truth facts the pipeline recovered from the degraded documents. Shown on the board. |

### The three confidence buckets

Never collapse these into a score, and never suppress the third.

- **`document-evidenced`** — backed by a source document. Becomes a draft prescription or referral.
- **`patient-reported`** — asserted by the patient on a call or in chat. Becomes a question for the clinician to confirm, never a prescription.
- **`uncertain-mapping`** — we found something and could not resolve it safely. Shown verbatim alongside whatever the pipeline guessed, and never actioned.

A hidden failed mapping is more dangerous than a flagged one, because a
clinician cannot compensate for what they cannot see.

## Decisions already made

- **The sim is the source of truth.** We never invent clinical content. The
  degrader re-presents sim facts as foreign documents; it does not author
  history. Because the sim record is the answer key, we can measure our own
  recovery rate.
- **Drug mapping is deterministic, never a model.** Fuzzy matchers return
  *different real drugs* with confidence — tested: `No-Spa` → hyoscyamine
  (truth: drotaverine), `Analgin` → paracetamol (truth: metamizole). Models do
  script transliteration; datasets do the mapping.
- **"No UK equivalent" is a correct answer**, not a failure. Metamizole and
  drotaverine genuinely aren't UK-licensed.
- **The orchestrator is code, not a model.** The control flow is a known DAG, so
  it's a function with `Promise.all`. Models are used where judgement is needed.
- **Guidelines are a hand-encoded rule pack**, each rule carrying its citation.
  NICE syndication takes weeks and its open licence excludes AI use; CKS and BNF
  are separately owned. We cite by URL, we don't ingest.
- **No patient assertion alone becomes a prescription.** Controlled-drug classes
  are hard-blocked from the recommendation path and surface as a flag.

## Data sources

All keyless, all in `data/`. Large files are fetched by `npm run data:fetch`.

| File | What | Licence |
|---|---|---|
| `bd_medicines.csv` | 21,714 Bangladeshi brands → generics (MEDEX) | open dataset |
| `indian_medicines.csv` | 253,973 Indian brands → composition | open dataset |
| `idd.sqlite` | 425,528 international brands, 44 countries | CC BY 4.0 |
| `formulary.json` | 3,214 Cambridge & Peterborough entries with RAG status | scraped once at build time — **do not hit live** |
| `bnf.csv` | 54,437 NHSBSA BNF rows | OGL v3.0 |
| `sim.json` | NHS simulator OpenAPI spec | — |

The brand datasets are registered per-country in `src/lib/sources.ts`. Adding a
country is one row — that's the answer to "does this only do Bengali?".

## Known gaps

- No dataset carries Bengali-script brand strings. A patient saying "নাপা" needs
  an LLM transliteration pass *before* the deterministic lookup.
- The formulary lists the same drug in several BNF subsections with different RAG
  status by indication. Key on subsection; don't collapse by name.
- Cervical screening interval depends on HPV result, not age alone (since July
  2025, HPV-negative 25–49 move to 5-yearly).
- `order_test` in the sim accepts only six panels: `fbc, ue, hba1c, lft, crp,
  lipids`. Anything else must become a referral.
- Vapi self-serve has no EU data residency. Our data is synthetic; in production
  this would need addressing.
