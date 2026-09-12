# 4. The orchestrator is code

Date: 2026-09-12

## Status

Accepted

## Context

The pipeline reads as an agentic workflow with an orchestrator and subagents. A
model-driven orchestrator costs a round trip per hop, varies run to run, and will
improvise during a demo run in front of judges.

Our control flow is known ahead of time: degrade, extract, map, apply rules,
close gaps, review, write back.

## Decision

Control flow is a TypeScript function. Fan-out is `Promise.all`.

Models run at two stages. Four extraction agents run in parallel over each
document, each with a narrow Zod schema, because one agent asked for medications
and immunisations and conditions at once returns worse output than four asked
separately. A single adjudicator then decides which gaps are worth a call.

## Consequences

Four extraction calls cost roughly one call of latency.

Stage transitions are written to `patients.stage` as each agent resolves, which
drives the board through Convex reactivity.

`@openai/agents` tracing records every run without extra code.
