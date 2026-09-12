---
name: nhs-sim
description: NHS neighbourhood simulator at sim.animahacks.com. Covers team keys, reading patient records, and writing prescriptions, referrals, tests and tasks through /actions. Use when calling the sim, picking an action type, building an action payload, or debugging a 400/409 from /actions.
---

# NHS simulator

Synthetic NHS neighbourhood: 50,000 patients across seven sites (`gp`, `hospital`,
`pharmacy`, `community`, `diagnostics`, `referrals`, `wearables`). Each team gets
an isolated world.

`data/sim.json` holds the full OpenAPI spec. Query it rather than guessing:

```bash
jq -r '.components.schemas.Action.properties.type.enum[]' data/sim.json
jq '.paths["/api/sites/{site}/actions"].post.requestBody.content["application/json"].examples' data/sim.json
```

## Auth

Team name is the join code. The same name returns the same key and the same
world, so teammates share the string, not the key.

```bash
curl -s $SIM_ORIGIN/api/keys -H 'Content-Type: application/json' \
  -d '{"teamName":"<team>"}' | jq -r .apiKey
```

Every other call carries `Authorization: Bearer $SIM_KEY`.

## Reading

```
GET /api/sites/{site}/patients?q=&offset=      search name, ID, condition, need, goal
GET /api/sites/{site}/view?patient=SIM-000001  full world state for one patient
GET /api/nhs/pds/Patient/{id}                  FHIR R4 Patient
GET /api/clock                                 simulation time
```

Page size on `/patients` is fixed at 30. `/view` returns `resources[]` with
`resourceTotal`, `resourceOffset` and `resourceLimit`, defaulting to 500.

## Writing

`POST /api/sites/{site}/actions`, with `Idempotency-Key` as a header. Reuse the
key when retrying the same action; use a fresh one for a new action.

A successful write returns the created resource with `id`, `kind`, `owner`,
`status`, `version` and a `provenance` block naming your team. That provenance is
the audit trail, so no separate logging is needed for anything written here.

Writes route across sites. A prescription drafted at `gp` is owned by `pharmacy`;
a referral is owned by `referrals`. Both become visible to `patient`. Showing the
resource in its destination site is how write-back is demonstrated.

### Prescription

All eight `medicationOrder` fields are required. `indication` is copied into
`data.text`, so it carries the evidence string.

```json
{"type":"draft_prescription","patientId":"SIM-000001","title":"...",
 "medicationOrder":{"drug":"Mebeverine 135mg tablets","dose":"1","unit":"tablet",
 "route":"Oral","frequency":"Three times daily","duration":"28 days",
 "quantity":84,"indication":"Substitute for No-Spa (drotaverine), not UK licensed."}}
```

### Referral

```json
{"type":"create_referral","patientId":"SIM-000001","title":"...","text":"...","target":"referrals"}
```

### Test

`panelId` accepts six values only: `fbc`, `ue`, `hba1c`, `lft`, `crp`, `lipids`.
Anything else becomes a referral.

```json
{"type":"order_test","patientId":"SIM-000001","title":"HbA1c",
 "bloodTestOrder":{"panelId":"hba1c","panel":"HbA1c","specimen":"EDTA blood",
 "priority":"routine","collection":"now","clinicalDetails":"..."}}
```

### Others

`save_problem`, `save_allergy`, `save_consultation`, `create_task`,
`book_appointment`, `share_record`, `process_document`, and `messaging_action`
(SMS or email to the patient, with `allowReply`).

## Gotchas

`createdAt` is simulation time, not wall clock. Read `/api/clock` and render sim
time.

Actions mutating an existing resource need `resourceId` and `expectedVersion`.
A stale version returns 409; re-read the resource and retry with its current
`version`.

The `control` site and every `/api/control/*` path need an operator token, so
patient creation and incident injection stay out of reach. Work with the 50,000
patients that exist.

SNOMED coverage is a document-annotation catalogue only. The GP record's own
codes are placeholders like `SIM-PROBLEM-1`. Use dm+d for medicines coding.
