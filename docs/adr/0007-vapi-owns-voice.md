# 7. Vapi owns the voice transport

Date: 2026-09-12

## Status

Accepted

## Context

The call needs to detect language, run in Bengali, follow a script, and return a
transcript with extracted fields.

Two options: Vapi's own model drives the call with server-side tools, or Vapi
points at our endpoint as a `custom-llm` and our agent loop becomes the voice.

Free Vapi numbers are US area codes, US-only, inbound only. Reaching a UK mobile
needs a Twilio import.

## Decision

Vapi's model drives the call. The orchestrator hands it a goal from an open
`Gap`, and reads `end-of-call-report` from a Convex `httpAction`.

The demo runs on `@vapi-ai/web` over WebRTC. Phone dial-in is optional.

## Consequences

`custom-llm` would mean debugging SSE streaming and sub-second latency in our own
endpoint. Vapi's baseline is around 800ms before our round trip.

Deepgram `nova-3` with `language: "multi"` detects language mid-call, and TTS
infers language from the text, so one assistant covers Bengali and English. The
system prompt must list the languages explicitly or the assistant does not use
them.

`language-change-detected` is not in the default `serverMessages` and must be
added. Vapi has since removed the value: it is not accepted in `serverMessages`
or `clientMessages`, and an assistant carrying it fails validation. The browser
call reads the script off the transcript instead.

`customerJoinTimeoutSeconds` defaults to 15 seconds and applies to web calls
only. Set it to 30 to 45 for conference wifi.

Calls start from a real click, or browser autoplay policy fails them with
`audio-start-failed`.

Vapi self-serve has no EU data residency until 2027. Our data is synthetic.
