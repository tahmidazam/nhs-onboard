/**
 * The model every stage of this repo calls, named in one place.
 *
 * Per [ADR 6](../../docs/adr/0006-openai-agents-sdk.md) the strong model, and
 * per [ADR 19](../../docs/adr/0019-model-calls-are-recorded-in-convex.md)
 * written down rather than inferred. `getDefaultModel()` from `@openai/agents`
 * returns this same name today, so reading it from the SDK looked equivalent —
 * but it makes the model a property of the installed dependency, which a bump
 * changes with no line of this repo changing. Pinned here, the model moves when
 * somebody edits this line and not otherwise.
 *
 * Two call sites read it: extraction in `convex/extract.ts`, which may override
 * per deployment with `EXTRACTION_MODEL`, and the degrader's translation in
 * `convex/lib/degradeTranslate.ts`. The Vapi assistant runs the same model, set
 * on the assistant in the Vapi dashboard rather than from here, per
 * [ADR 7](../../docs/adr/0007-vapi-owns-voice.md).
 *
 * It is a reasoning model, and the Chat Completions API rejects any
 * `temperature` other than the default for it. See `degradeTranslate.ts`.
 */
export const MODEL = 'gpt-5.6-luna'
