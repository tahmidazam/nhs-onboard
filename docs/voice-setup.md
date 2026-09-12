# Running the voice path

Everything the call needs lives on the Convex deployment and in the Vapi
dashboard. None of it is committed, because it is all either a secret or a
personal phone number, so a fresh clone needs this once.

## Making a phone actually ring

Press **Call** on a board row, then **Call the patient** in the sheet that
opens. Four deployment variables have to be set before that does anything. If
any is missing the button surfaces an Alert naming it, rather than failing
quietly.

```bash
npx convex env set VAPI_PRIVATE_KEY <Vapi dashboard, API Keys>
npx convex env set VAPI_ASSISTANT_ID <the assistant's id>
npx convex env set VAPI_PHONE_NUMBER_ID <Vapi's id for the Twilio number>
npx convex env set DEMO_PHONE_NUMBER <the number to ring, in E.164>
```

Run `npx convex env list` afterwards. All four should be there.

Three things go wrong here, in roughly this order of frequency.

**`VAPI_PHONE_NUMBER_ID` is not the phone number.** It is a UUID from the
dashboard's phone numbers page, identifying the number inside Vapi. Pasting the
actual digits gets a rejection from Vapi that does not say why.

**`DEMO_PHONE_NUMBER` must be E.164.** Drop the leading zero and put the country
code on: `07700 900000` becomes `+447700900000`. No spaces. `place` checks the
format and refuses with an explanation rather than letting Vapi reject it, so if
you got this wrong the error tells you.

**The number must be an imported one.** Free Vapi numbers cannot dial out or
call internationally. It has to be a Twilio, Vonage or Telnyx number imported
into the account.

Ask whoever owns the phone for the number. It is deliberately not written down
in this repo, which is public.

## Getting the transcript back

The call can work perfectly and still leave the `calls` row empty. That happens
when the assistant's **server URL** is wrong, and it fails silently.

```
https://<deployment>.convex.site/vapi
```

The host ends **`.convex.site`**, not `.convex.cloud`. Your `VITE_CONVEX_URL` is
the `.cloud` one, so it is not the value to paste. `.env` and `.env.local` both
carry `VITE_CONVEX_SITE_URL`, which is.

`end-of-call-report` must be among the assistant's server messages. It is on by
default.

Vapi validates that list and rejects anything not on it. `language-change-detected`
used to be valid and is not any more, so an assistant carrying it will not save.
Nothing in this repo needs it: the browser call reads the script off the
transcript instead. `serverUrl` is also deprecated in favour of `server.url`,
which Vapi transforms for you.

Once that is right, hanging up puts the transcript under **Saved transcript** in
the sheet within a second or two, with no refresh. The query is reactive.

To check the webhook without spending call credit, register a row and post a
report to it:

```bash
npx convex run call:register '{"patientId":"<id>","vapiCallId":"probe-1"}'
curl -X POST https://<deployment>.convex.site/vapi \
  -H 'Content-Type: application/json' \
  -d '{"message":{"type":"end-of-call-report","endedReason":"hangup",
       "call":{"id":"probe-1"},"artifact":{"transcript":"AI: test"}}}'
npx convex run call:latestCall '{"patientId":"<id>"}'
```

A `status` of `complete` with the transcript back means the whole server half
works, and anything still broken is on Vapi's side.

## The browser call

`.env.local` needs the two browser values. Both are safe to expose.

```
VITE_VAPI_PUBLIC_KEY=
VITE_VAPI_ASSISTANT_ID=
```

`VITE_VAPI_ASSISTANT_ID` is the same id as `VAPI_ASSISTANT_ID` above. Server
variables cannot carry the `VITE_` prefix and browser variables must, so it is
set in both places.

Scope the public key to the assistant and to `http://localhost:5173` under
allowed origins, or the browser refuses the call. Start it from a real click:
autoplay policy fails a call that was not, with `audio-start-failed`.

## The assistant

Defined in the dashboard, not in code, so it can be retuned without a deploy.

| Setting | Value |
|---|---|
| Server URL | `https://<deployment>.convex.site/vapi` |
| Server messages | `end-of-call-report` |
| Transcriber | multilingual, so the language can change mid-call |
| customerJoinTimeoutSeconds | 45, since 15 is short on conference wifi |

The system prompt must contain `{{patientName}}`, `{{patientAge}}`,
`{{patientDob}}` and `{{goals}}`. Without them the call still runs and quietly
ignores which patient it is about, asking whatever the prompt hardcodes.
`docs/vapi-system-prompt.md` holds the version those variables match.

## Something to call about

`{{goals}}` comes from the patient's open gaps, and nothing writes gaps for a
patient onboarded from the simulator yet. On an empty board, **Create the demo
patient** seeds one patient and four gaps through `convex/dev.ts`. Delete that
file, and the button in `Board.tsx`, once `convex/rules.ts` runs as part of
onboarding.

## Budget

Around $5 of credit is 60 to 70 minutes of calls in total, shared across
everyone testing. The webhook probe above costs nothing, so use it for anything
that is not specifically about the audio.
