# 6. OpenAI Agents SDK, not the Anima ADK

Date: 2026-09-12

## Status

Accepted

## Context

The hackathon brief offers the Anima ADK and states that teams do not have to use
it. No judging criterion mentions it.

We bundle-tested both against esbuild, targeting Convex Node actions.

The ADK installs at 66MB, declares `openai` as an undeclared peer dependency, and
pulls dynamic imports of `playwright` and `jsdom` from its root export. The
bundle failed after marking six externals.

`@openai/agents` installs at 74MB dev, bundles to 4.2MB with no externals, and
imports cleanly. It requires `zod@^4`, which matches the repo.

## Decision

Use `@openai/agents` for the extraction agents and the gap adjudicator.

## Consequences

Tracing is on by default and records every run, tool call and handoff in the
OpenAI dashboard, which covers the requirement that every stage be recorded.

The SDK runs on the Responses API, so prompt caching applies. Static content goes
at the front of prompts and patient content at the back.

Prompts live in the OpenAI dashboard as versioned objects, referenced by
`prompt: { id, version }`. Non-developers edit them without a deploy. Versions
are pinned during the build and unpinned at 16:00.
