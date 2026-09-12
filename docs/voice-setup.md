# Running the voice path

Everything the call needs lives on the Convex deployment and in the Vapi
dashboard. Nothing is committed, so a fresh clone needs this once.

## On the deployment

```bash
npx convex env set VAPI_PRIVATE_KEY <from Vapi, API Keys>
npx convex env set VAPI_ASSISTANT_ID <the assistant's id>
npx convex env set VAPI_PHONE_NUMBER_ID <Vapi's id for the Twilio number>
npx convex env set DEMO_PHONE_NUMBER +44...
```

`VAPI_PHONE_NUMBER_ID` is a UUID from the phone numbers page, not the phone
number. Free Vapi numbers cannot dial out, so the number has to be an imported
Twilio, Vonage or Telnyx one.

`DEMO_PHONE_NUMBER` is the phone the button rings. Set it to your own.

## In the browser env

`.env.local` needs the two browser values. Both are safe to expose.

```
VITE_VAPI_PUBLIC_KEY=
VITE_VAPI_ASSISTANT_ID=
```

Scope the public key to the assistant and to `http://localhost:5173` under
allowed origins, or the browser call is refused.

## On the assistant

Defined in the dashboard, not in code, so it can be retuned without a deploy.

| Setting | Value |
|---|---|
| Server URL | `https://<deployment>.convex.site/vapi` |
| Server messages | include `end-of-call-report` and `language-change-detected` |
| Transcriber | Deepgram `nova-3`, language `multi` |
| customerJoinTimeoutSeconds | 45 |

The server URL host ends `.convex.site`, not `.convex.cloud`. Pointing it at
`.cloud` fails silently: calls run and no transcript ever arrives.

The system prompt must contain `{{goals}}` and `{{patientName}}`. Without them
the call runs and ignores the patient's gaps. `docs/vapi-system-prompt.md` holds
a draft.

## Trying it

```bash
npx convex dev     # terminal 1
pnpm dev           # terminal 2
```

The shell at `:5173` offers **Create the demo patient** on an empty database,
which seeds one patient and four gaps through `convex/dev.ts`. Delete that file
once `convex/sim.ts` and `convex/rules.ts` write those rows for real.

**Call the patient** rings `DEMO_PHONE_NUMBER`. **Call Rahim Uddin** runs the
same questions in the browser over WebRTC. Either way the transcript arrives on
the webhook and lands in `calls`.
