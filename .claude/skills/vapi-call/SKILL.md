---
name: vapi-call
description: Vapi voice agent for multilingual patient calls. Covers assistant config, language auto-detection, the web SDK used for demos, server tools, and reading transcripts from the end-of-call-report webhook. Use when building or debugging the call, wiring the Convex webhook, or a call fails to connect or answers in the wrong language.
---

# Vapi voice calls

The call closes one `Gap`. The orchestrator hands the assistant a goal, the call
runs, and `end-of-call-report` returns claims tagged `patient-reported`.

See `docs/adr/0007-vapi-owns-voice.md` for why Vapi's own model drives the call.

## Assistant

Define the assistant **in the Vapi dashboard**, not inline in code, so Alisha and
Neil can retune the script between test calls without a deploy. Code references
it by id.

```json
{
  "transcriber": { "provider": "deepgram", "model": "nova-3", "language": "multi" },
  "voice": { "provider": "azure", "voiceId": "multilingual-auto" },
  "artifactPlan": { "recordingEnabled": true, "transcriptPlan": { "enabled": true } },
  "serverMessages": ["end-of-call-report", "tool-calls"],
  "customerJoinTimeoutSeconds": 45
}
```

Deepgram `multi` detects language mid-call and TTS infers language from the text,
so one assistant covers Bengali, Hindi and English with no handoff.

**List every supported language explicitly in the system prompt.** Assistants
otherwise behave as though they speak only English, whatever the transcriber
detects.

`language-change-detected` is no longer a valid `serverMessages` or
`clientMessages` value. Vapi rejects the whole assistant if it is present, so
there is no language event to listen for. `src/components/call/CallPanel.tsx`
reads the script off the transcript instead.

`serverUrl` is deprecated in favour of `server.url`. Vapi transforms it and warns.

## Running a call

Demos run on the web SDK over WebRTC. Free Vapi numbers are US-only and inbound
only, so phone dial-in needs a Twilio import.

```ts
import Vapi from '@vapi-ai/web'
const vapi = new Vapi(import.meta.env.VITE_VAPI_PUBLIC_KEY)

vapi.on('message', (m) => {
  if (m.type === 'transcript' && m.transcriptType === 'final') append(m.role, m.transcript)
})
vapi.on('call-start-failed', showBanner)
vapi.on('network-quality-change', showBanner)

button.onclick = () => vapi.start(assistantId, { variableValues: { goal, patientName } })
```

Start the call from a real click. Browser autoplay policy otherwise fails it with
`audio-start-failed` and attaches no audio player.

`customerJoinTimeoutSeconds` defaults to 15 and applies to web calls only. It
covers network, mic permission and the WebRTC handshake, so conference wifi needs
30 to 45.

The browser uses the **public** key, scoped by allowed origins and assistants in
the dashboard. The private key stays on the Convex side.

The dashboard's per-assistant Talk button is the zero-code fallback when a laptop
misbehaves.

## Webhook

Vapi posts to a Convex `httpAction`, which gives a stable public URL with no
tunnel.

```ts
// convex/http.ts
http.route({ path: '/vapi', method: 'POST', handler: httpAction(async (ctx, req) => {
  const { message } = await req.json()
  if (message.type === 'end-of-call-report') {
    await ctx.runMutation(internal.call.complete, {
      vapiCallId: message.call.id,
      transcript: message.artifact.transcript,
      structured: message.call.artifact?.structuredOutputs,
    })
  }
  return new Response(null, { status: 200 })
})})
```

`end-of-call-report` is on by default and carries `artifact.transcript`,
`artifact.messages[]` and the recording. Vapi also runs structured extraction
against a JSON schema post-call, landing in `call.artifact.structuredOutputs`.

## Tools

A `function` tool posts `tool-calls` to the server URL and must be answered in
the documented shape:

```json
{ "results": [{ "toolCallId": "call_...", "result": "..." }] }
```

Vapi's baseline is around 800ms before the tool round trip, so set
`server.timeoutSeconds` to 5 to 10 rather than the 20 default, and use tool
`messages` for spoken filler while waiting.

## Budget

$5 free credits, around 60 to 70 minutes all-in. Add the OpenAI key under
Dashboard, Integrations so LLM cost bills to the project's own credits. Stop test
loops when they finish.
