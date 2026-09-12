/**
 * The four extraction agents, as data: one Zod schema and one prompt each.
 * No IO, no model call, no Convex import — `convex/extract.ts` runs these and
 * writes the Claims.
 *
 * The prompts live beside their schemas rather than in the OpenAI dashboard.
 * That narrows docs/adr/0006-openai-agents-sdk.md's consequence clause for
 * extraction only: the prompt and the schema are one artefact, and a dashboard
 * edit asking for a field the schema does not declare fails at runtime with no
 * type error, no build failure, and the edit not in the repo.
 *
 * What the schemas leave out is the point of
 * docs/adr/0016-extraction-is-the-only-model-stage.md.
 *
 * No `confidence`. Code assigns the bucket from the source kind, whether the
 * quote anchored per ADR 17, and whether the brand lookup resolved. A model has
 * no input to that which code lacks, and given the field it would fill it
 * plausibly and occasionally wrong in our favour.
 *
 * No parsed date, no computed age, no `ageAtDoseMonths`. The immunisation agent
 * returns the date text as written and nothing derived from it, because
 * `ukhsa-imm-mmr-under-12-months` branches on whether the record *can* say what
 * age a dose was given at, and a degraded vaccination card says "as a child". A
 * model handed a number field and those words produces a number, and the number
 * is wrong and confident. Code parses what is parseable and leaves the rest
 * undefined.
 *
 * No `kind`, `patientId`, `id` or any part of `source`. All written by code from
 * the document being processed, which is also what stops an agent merging facts
 * across two documents: it sees exactly one.
 *
 * Four agents, five ClaimKinds. `family-history` folds into the condition agent
 * behind a `subject` discriminator and `claimKindFor` maps it back. `allergy`
 * stays separate from `medication` deliberately, though both appear on a
 * prescription list: the characteristic extraction error on a foreign document
 * is a drug name on an allergy line arriving as a current medication, and it is
 * the one confusion with a prescribing consequence, because under
 * docs/adr/0003-three-confidence-buckets.md a `document-evidenced` medication
 * can become a draft prescription while a `document-evidenced` allergy is a
 * contraindication.
 */

import { z } from 'zod'
import type { ClaimKind } from '../../src/types'

/**
 * Absent values are `null`, not missing keys. OpenAI strict Structured Outputs
 * requires every property to be required, and `openai/lib/transform.js` throws
 * on a `.optional()` that is not also nullable before a request is ever sent.
 * The runner reads `null` as "the document does not say" and writes `undefined`.
 */
const absent = <T extends z.ZodType>(schema: T) => schema.nullable()

/** The fact as written in the source language and script. Never overwritten downstream. */
const verbatim = z
  .string()
  .describe(
    'The fact exactly as written in the document, in its own language and script. Copied, never translated or tidied. Must appear inside `quote` character for character.',
  )

/**
 * What "evidenced" means here, per docs/adr/0017-quotes-are-anchored-by-containment.md.
 * Code verifies this is a literal substring of the document and that `verbatim`
 * is a literal substring of it; a paraphrased, transliterated or translated
 * quote fails verification and demotes the claim to `uncertain-mapping`.
 */
const quote = z
  .string()
  .describe(
    'The surrounding line or sentence the fact rests on, copied character for character from the document: same script, same spelling, same punctuation, same digits. Never translated, transliterated, tidied or paraphrased.',
  )

/** Translation of the span and nothing else. See docs/adr/0018-translation-sits-in-the-recovery-path.md. */
const english = z
  .string()
  .describe(
    'A plain English translation of the `verbatim` span and nothing else. Never a diagnosis, never a clinical code, never an expansion of an abbreviation, never a normalisation to a standard term. If the span is already English, repeat it unchanged.',
  )

const medicationItem = z.object({
  verbatim,
  /**
   * Feeds ADR 2's deterministic lookup and never replaces it. A translation
   * here resolves correctly by the wrong route and silently bypasses the whole
   * defence, so the prompt forbids it and the mapping pass guards it.
   */
  latin: z
    .string()
    .describe(
      'The brand name transliterated into Latin script: its sounds, not its meaning. `নাপা` becomes `Napa`. Never the generic, ingredient or English name of the drug. If the name is already in Latin script, repeat it unchanged.',
    ),
  dose: absent(z.string()).describe(
    'The dose as written, e.g. `500 mg`. Null where the document gives none.',
  ),
  frequency: absent(z.string()).describe(
    'The frequency as written, e.g. `দিনে ৩ বার`. Null where the document gives none.',
  ),
  quote,
})

const conditionItem = z.object({
  verbatim,
  english,
  /** Folds `family-history` into this agent. `claimKindFor` maps it back. */
  subject: z
    .enum(['patient', 'family'])
    .describe(
      "`patient` where the condition is the patient's own, `family` where the document attributes it to a relative.",
    ),
  quote,
})

const allergyItem = z.object({
  verbatim,
  english,
  reactionText: absent(z.string()).describe(
    'The reaction as the document describes it, e.g. `rash`, `swelling`, translated into English. Null where the document gives none.',
  ),
  quote,
})

const immunisationItem = z.object({
  verbatim,
  english,
  /** Raw text only. Parsing it here is what ADR 16 forbids. */
  dateText: absent(z.string()).describe(
    'The date or time expression exactly as the document gives it, e.g. `2015`, `০৩/০৪/২০১৯`, `as a child`. Copied, never parsed, converted, completed or turned into an age. Null where the document gives none.',
  ),
  quote,
})

export type MedicationItem = z.infer<typeof medicationItem>
export type ConditionItem = z.infer<typeof conditionItem>
export type AllergyItem = z.infer<typeof allergyItem>
export type ImmunisationItem = z.infer<typeof immunisationItem>

/**
 * `outputType` must be a Zod object, so each agent's array is wrapped in one
 * under a uniform `items` key the runner can read without a per-agent branch.
 */
const output = <T extends z.ZodType>(item: T, noun: string) =>
  z.object({
    items: z.array(item).describe(`Every ${noun} the document states. Empty where it states none.`),
  })

const medicationOutput = output(medicationItem, 'current medication')
const conditionOutput = output(conditionItem, 'condition')
const allergyOutput = output(allergyItem, 'allergy')
const immunisationOutput = output(immunisationItem, 'immunisation')

/**
 * The invariants every agent shares. Written once so the four cannot drift
 * apart on the two rules that decide whether a claim is checkable: the quote is
 * copied, and nothing is invented.
 */
const contract = (noun: string, plural: string) => `You are reading one document from a patient's foreign medical history, presented at GP registration in the UK. It may be a prescription list, a discharge summary, a vaccination card or a clinic letter. It may be in any language or script, and it may be partial, handwritten or badly transcribed.

Report ${plural} and nothing else. Other agents are reading the same document for the other kinds of fact, so a fact that is not ${noun} is not yours: reporting it here is an error, not a bonus. This matters most on a prescription list, where a drug named on an allergy line is an allergy and never a medication.

For every ${noun} you report:

- \`quote\` is the line or sentence in the document that the fact rests on, copied character for character: same script, same spelling, same punctuation, same digits, same spacing. Do not translate it, do not transliterate it, do not tidy it, do not correct what looks like a typo, do not join two lines into one. Code checks that your quote appears in the document exactly as you wrote it, and that \`verbatim\` appears inside your quote. Altering the quote in any way invalidates the claim and the fact reaches the clinician marked unverified.
- \`verbatim\` is the fact itself, as written, in the document's own language and script, sitting inside \`quote\` character for character.

Report only what the document states. If it holds no ${plural} at all, return an empty list. An empty list is a correct answer; a guessed, inferred or completed fact is not.`

export const MEDICATION_PROMPT = `${contract('a medication', 'current medications')}

\`latin\` is a transliteration of the brand name into Latin script: its sounds, not its meaning. \`নাপা\` transliterates to \`Napa\`. Answering \`Paracetamol\` is wrong, even though Napa is a paracetamol brand. The UK ingredient is decided downstream by a lookup against national drug datasets, and a name you translated resolves by the wrong route and bypasses that check entirely. Never substitute the generic, ingredient, English or UK name of the drug. Where the name is already written in Latin script, repeat it unchanged.

\`dose\` and \`frequency\` are copied as written when the document gives them, and null when it does not. Do not convert units, do not standardise a schedule, do not supply a usual dose.`

export const CONDITION_PROMPT = `${contract('a condition', 'conditions and diagnoses')}

\`english\` is a translation of the \`verbatim\` span and nothing else. Translate the words that are there. It is never a diagnosis you inferred, never a clinical code, never an abbreviation expanded into a fuller diagnosis, never a lay phrase normalised to a standard term. Where a document gives the lay phrase for "sugar disease", the english is that phrase translated, not "Type 2 diabetes mellitus". Where the span is already English, repeat it unchanged.

\`subject\` separates the patient's own conditions from a relative's. A line naming a mother, father, brother or sister is \`family\`; everything else is \`patient\`.`

export const ALLERGY_PROMPT = `${contract('an allergy', 'allergies and intolerances')}

An allergy is a substance the document records the patient as reacting to. A drug named on an allergy line is an allergy, however much the line resembles a prescription: it is a contraindication, and a downstream system treats it as the opposite of a medication.

\`english\` is a translation of the \`verbatim\` span and nothing else. Translate the words that are there. It is never a diagnosis you inferred, never a clinical code, never an abbreviation expanded into a fuller term, never a substance normalised to a standard name. Where the span is already English, repeat it unchanged.

\`reactionText\` is the reaction as the document describes it, translated, and null where it describes none. Do not grade a reaction the document did not grade, and do not infer one from the substance.`

export const IMMUNISATION_PROMPT = `${contract('an immunisation', 'immunisations and vaccinations')}

\`english\` is a translation of the \`verbatim\` span and nothing else — the vaccine as named, never expanded into a schedule, a dose number or a standard programme name. Where the span is already English, repeat it unchanged.

\`dateText\` is the date or time expression exactly as the document writes it, and null where it gives none. Copy \`2015\`, \`০৩/০৪/২০১৯\` or \`as a child\` as they stand. Never parse it, never convert a calendar or a numeral system, never complete a partial date, never compute an age from it. A vague date must stay vague: code decides later what is parseable, and a record that cannot say when a dose was given must not be made to say.`

/** One agent: a schema, its prompt, and what a runner needs to trace and file the result. */
export interface ExtractionAgent {
  /** Trace name in the OpenAI dashboard. */
  readonly name: string
  /**
   * The ClaimKinds this agent's items can become. One each, except the
   * condition agent, whose `subject` discriminator maps to two.
   */
  readonly kinds: readonly ClaimKind[]
  /** Passed to the SDK as `outputType`. Items are under `items`. */
  readonly outputType: z.ZodObject
  /**
   * Passed to the SDK as `instructions`. Static in full: per ADR 6 the SDK runs
   * on the Responses API, so the document goes at the back, as the run input.
   */
  readonly prompt: string
}

export const medicationAgent = {
  name: 'extract-medication',
  kinds: ['medication'],
  outputType: medicationOutput,
  prompt: MEDICATION_PROMPT,
} as const satisfies ExtractionAgent

export const conditionAgent = {
  name: 'extract-condition',
  kinds: ['condition', 'family-history'],
  outputType: conditionOutput,
  prompt: CONDITION_PROMPT,
} as const satisfies ExtractionAgent

export const allergyAgent = {
  name: 'extract-allergy',
  kinds: ['allergy'],
  outputType: allergyOutput,
  prompt: ALLERGY_PROMPT,
} as const satisfies ExtractionAgent

export const immunisationAgent = {
  name: 'extract-immunisation',
  kinds: ['immunisation'],
  outputType: immunisationOutput,
  prompt: IMMUNISATION_PROMPT,
} as const satisfies ExtractionAgent

/** Fanned out over each document with `Promise.all`. Order is the trace order, nothing more. */
export const EXTRACTION_AGENTS = [
  medicationAgent,
  conditionAgent,
  allergyAgent,
  immunisationAgent,
] as const

/** Maps the condition agent's discriminator back to the two ClaimKinds it covers. */
export function claimKindFor(subject: ConditionItem['subject']): ClaimKind {
  return subject === 'family' ? 'family-history' : 'condition'
}
