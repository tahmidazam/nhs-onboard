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

/* -------------------------------------------------------------------------- */
/* The two transcript agents.                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reading the call is the second thing a model does in this pipeline, and it is
 * still extraction: text in, claims and answers out, no clinical judgement. See
 * docs/adr/0016-extraction-is-the-only-model-stage.md and ADR 22.
 *
 * These are not in `EXTRACTION_AGENTS`. That array is fanned out over every
 * document by convex/extract.ts, and a transcript is not a document.
 *
 * Our own schema rather than Vapi's `structuredOutputs`. Vapi runs its own
 * post-call extraction against a JSON schema set in the dashboard, and
 * convex/call.ts logs the result. It is not parsed, for three reasons. The repo
 * has never seen a real end-of-call-report payload, so the shape of that field
 * is unknown rather than merely undocumented. Confirming it costs a live call
 * against roughly sixty minutes of credit shared across the team, and a schema
 * that cannot be tested without spending that cannot be iterated on. And it is
 * the same argument this file's header already makes about the prompts: a
 * dashboard edit asking for a field nothing here declares fails at runtime,
 * with no type error, no build failure, and the edit not in the repo. Our
 * schema lives beside the code that reads it and runs against a stored
 * transcript for free.
 */

/**
 * The patient's own words. Same containment contract as a document's
 * `verbatim`, re-described because the source is a mouth rather than a page.
 */
const spokenVerbatim = verbatim.describe(
  'The fact exactly as the patient said it, in the language and script they said it in. Copied from their line, never translated, tidied or completed. Must appear inside `quote` character for character.',
)

/**
 * The anchor target is the patient's turns alone, not the whole transcript.
 * convex/callExtract.ts builds that string with `parseTurns`/`formatTurns` and
 * runs ADR 17's containment against it, so a quote lifted from an `AI:` line
 * fails structurally rather than by prompting.
 */
const spokenQuote = quote.describe(
  "One of the PATIENT's own lines from the transcript, copied character for character: same words, same script, same spelling, same digits. Never a line the assistant spoke, never two lines joined, never translated or tidied. Code checks your quote against the patient's lines only, and that `verbatim` appears inside it.",
)

/**
 * The invariants both transcript agents share, written once. The assistant's
 * lines are context and never evidence, which is the whole of why this is worth
 * its own contract rather than reusing the document one.
 */
const TRANSCRIPT_CONTRACT = `You are reading the transcript of one telephone call between an automated onboarding assistant and a patient who has just registered with a GP practice in England. The call may be in any language, and either speaker may change language part way through.

The transcript is one string, one turn per line, each line prefixed with who spoke: \`AI:\` for the assistant, \`User:\` for the patient. You are given the whole call, the assistant's lines included, because a patient's "yes" means nothing without the question above it.

Only what the patient said is evidence. The assistant's lines are there so you can tell what a short answer refers to, and for nothing else. This matters more than it sounds. The assistant is instructed to read every medicine name, every strength and every frequency back out loud at least twice, to ask the patient to produce the value a second time independently, and at one point to deliberately read back a WRONG number to test whether the patient is still listening rather than just agreeing. So a drug name or a dose that appears only in an \`AI:\` line is the assistant's guess, or a guess it made on purpose. Reporting it turns our own guess into a fact in a medical record. Code checks every quote against the patient's lines alone and rejects anything else, so a quote taken from the assistant is discarded rather than corrected.

Report only what the patient established. A question the call never reached, a subject nobody mentioned and a fact the patient declined to give are all absences, and an empty list is a correct answer. Never fill a gap with something plausible.`

/**
 * The five ClaimKinds, chosen by the model here. On a document `kind` is
 * assigned by code, from which agent read it, for two reasons that both fall
 * away on a call.
 *
 * The first is cross-document merging: an agent sees exactly one document so it
 * cannot fuse facts across two, and there is one transcript, so there is
 * nothing to fuse.
 *
 * The second is the prescribing consequence. On a prescription list a drug name
 * sitting on an allergy line is the characteristic extraction error, and under
 * docs/adr/0003-three-confidence-buckets.md a `document-evidenced` medication
 * can become a draft prescription while an allergy is a contraindication, so
 * the confusion has to be structural. A transcript claim is `patient-reported`
 * unconditionally, by `bucketFor` in convex/lib/confidence.ts, whatever it
 * sounds like. It becomes a question for the clinician and cannot reach the
 * prescription path at all, so the kind is safe to ask for and four parallel
 * agents over one transcript would be four times the cost for the same answer.
 */
const spokenKind = z
  .enum(['medication', 'condition', 'immunisation', 'family-history', 'allergy'])
  .describe(
    "What kind of fact this is. `medication` is something the patient takes now, prescribed or over the counter. `allergy` is a substance they react to, never a medication, however much it sounds like one. `condition` is a diagnosis or problem of their own. `family-history` is a condition they attribute to a parent, brother or sister. `immunisation` is a vaccination they say they have had.",
  )

const transcriptClaimItem = z.object({
  kind: spokenKind,
  verbatim: spokenVerbatim,
  /**
   * ADR 18's translation, and null on a medication: `Claim.resolved` for a
   * medication comes from the dm+d lookup in convex/map.ts and from nowhere
   * else, so a value here would be overwritten or, worse, believed.
   */
  english: absent(english).describe(
    'A plain English translation of the `verbatim` span and nothing else, where the patient spoke another language. Repeat it unchanged where the span is already English. Never a diagnosis you inferred, never a clinical code, never an abbreviation expanded, never a lay phrase normalised to a standard term. Null for a medication, always: a medicine name is transliterated and looked up downstream, never translated.',
  ),
  quote: spokenQuote,
})

const transcriptAnswerItem = z.object({
  /**
   * A one-based index into the numbered list the assistant was given, frozen on
   * `calls.goals`. The number and nothing else: the question text is not asked
   * for, because a rephrasing cannot be resolved back to a gap row.
   */
  goalNumber: z
    .number()
    .int()
    .describe(
      'Which of the numbered questions this answers, counting from 1 as they are numbered in the list above. Never a number the list does not have.',
    ),
  /**
   * Two members, and deliberately no `not-asked`. A question the call never
   * reached is expressed by absence from the array, so "said nothing about
   * question 3" and "said question 3 was not asked" cannot disagree.
   */
  outcome: z
    .enum(['answered', 'asked-and-not-known'])
    .describe(
      "`answered` where the patient established the answer, including an approximate one they hedged. `asked-and-not-known` where the assistant asked and the patient could not say: they did not know, could not remember, had no papers, or it was left for someone at the surgery to check. Use `asked-and-not-known` rather than guessing what they meant. If the call never asked the question at all, leave it out of the list entirely rather than reporting it here.",
    ),
  answer: absent(z.string()).describe(
    "The answer in plain English, as short as it can be while staying complete: the medicine with its strength and frequency, the year, the relative and the condition. An approximation keeps its hedge: `about fifteen years ago`, not `2011`. Null where the patient could not say, or the patient's own words for not knowing where those are worth keeping.",
  ),
  quote: spokenQuote,
})

/**
 * Sex, asked for here because the sim carries it in no field and a patient's
 * own statement outranks a pronoun read off a document. Written to
 * `patients.sex` as `patient-reported`, and only when the field is still
 * absent and the quote anchored. See ADR 20.
 *
 * An object rather than a bare enum, because the value needs the line it came
 * from: `patients.sex.source` is a `SourceRef` like every other, and a sex with
 * no quote could not be anchored and so could not be told apart from a guess
 * about a voice.
 */
const spokenSex = absent(
  z.object({
    value: z.enum(['male', 'female']),
    quote: spokenQuote,
  }),
).describe(
  "The patient's sex, but only where they say it themselves in words, and null in every other case. Never infer it from how their voice sounds, from their name, from a title, or from a pronoun the assistant used: the assistant is guessing there too. Null is the normal answer.",
)

const transcriptClaimOutput = z.object({
  items: z
    .array(transcriptClaimItem)
    .describe(
      'Every fact of these five kinds the patient stated about themselves on this call. Empty where they stated none.',
    ),
  sex: spokenSex,
})

const transcriptAnswerOutput = z.object({
  items: z
    .array(transcriptAnswerItem)
    .describe(
      'One entry per numbered question the call actually asked and reached an outcome on. Empty where it reached none. Never two entries for the same number.',
    ),
})

export type TranscriptClaimItem = z.infer<typeof transcriptClaimItem>
export type TranscriptAnswerItem = z.infer<typeof transcriptAnswerItem>

export const TRANSCRIPT_CLAIM_PROMPT = `${TRANSCRIPT_CONTRACT}

Report every medication, allergy, condition, family history and immunisation the patient stated about themselves, and nothing else. Another agent is reading the same transcript for whether the call's specific questions were answered, so that is not yours.

A spoken negative is not a claim. "I don't take anything", "no allergies that I know of", "nobody in my family has anything like that" all mean there is nothing to report, so report nothing. An empty list is a correct answer; a claim invented out of a denial is the worst kind of error this pipeline can make, because it is unfalsifiable from the record.

Neither is a plan a claim. A test being booked, a vaccination being referred for review, a pharmacist being asked to check a dose: none of those is a fact about the patient's history. Leave them out.

Report the same fact once, at its most complete. Where the patient said a medicine name early and its strength three turns later, that is one medication, quoted from the line carrying the part you are reporting as \`verbatim\`.

A fact the patient hedged is still a fact. Keep the hedge in the \`verbatim\` and in the \`english\`, and do not resolve it: \`maybe some kind of blood pressure tablet\` is reported as it was said, not as a drug name.

\`verbatim\` is the fact, not the sentence around it. The sentence is already in \`quote\`.

- A medication is the name of the medicine and nothing else: \`amlodipine\`, never \`amlodipine, five milligrams once in the morning\`. The strength and the frequency stay in the quote, which carries them. A name with a dose stuck to it matches no drug dataset, and the lookup that turns a foreign brand into a UK ingredient is a literal one, so it fails on the whole phrase and the medicine reaches the clinician unmapped.
- An allergy is the substance: \`penicillin\`, never \`penicillin, it gave me a rash all over when I was young\`.
- A condition is the diagnosis or the complaint, and an immunisation is the vaccine as named.
- A family history is the relative and the condition together, because neither is the fact on its own: \`my mother had a stroke\`.`

export const TRANSCRIPT_ANSWER_PROMPT = `${TRANSCRIPT_CONTRACT}

The assistant was given a numbered list of questions the patient's records could not answer, and told not to end the call without them. Your job is to say, for each one, what the call actually established. The list is given to you below the transcript, numbered exactly as the assistant received it.

Report one entry per question the call asked AND reached an outcome on. Nothing else.

- A question the call never got to has no entry. Not \`asked-and-not-known\`, no entry at all. Silence and "not asked" must not be two different answers in this output, so there is only one way to say it.
- A question the assistant asked and the patient could not answer is \`asked-and-not-known\`. That is a real outcome and worth recording: the practice learns that asking again is pointless and a proxy is needed. The assistant is instructed to say out loud that it is marking a question as asked and not known, so the transcript usually says so plainly.
- A question answered only by the assistant reading something back is not answered. Two of the assistant's readbacks are wrong on purpose. The quote must be the patient's own line, or the answer is discarded.
- Never two entries with the same \`goalNumber\`. Where the call came back to a question and the patient corrected themselves, report the corrected answer once, quoted from the line they corrected it on.
- Never a \`goalNumber\` the list does not contain.

\`answer\` is what the practice will read in the record, so it must stand on its own: "Metformin, five hundred milligrams, twice a day", not "yes" or "the first one". Keep an approximation approximate.`

/**
 * One transcript agent: a schema, its prompt, and what a runner needs to trace
 * it. A sibling of `ExtractionAgent` rather than an instance of it, because
 * `kinds` exists there so `toDraft` can pick `kinds[0]` for an item whose kind
 * code assigned, and the claim agent returns `kind` itself. Folding the two
 * interfaces together would put a field on one that the other must not read.
 */
export interface TranscriptAgent {
  /** Trace name in the OpenAI dashboard, and `agentRuns.agent`. */
  readonly name: string
  /** Passed to the SDK as `outputType`. Items are under `items`, as above. */
  readonly outputType: z.ZodObject
  /** Passed to the SDK as `instructions`. The transcript goes at the back. */
  readonly prompt: string
}

export const transcriptClaimAgent = {
  name: 'transcript-claims',
  outputType: transcriptClaimOutput,
  prompt: TRANSCRIPT_CLAIM_PROMPT,
} as const satisfies TranscriptAgent

export const transcriptAnswerAgent = {
  name: 'transcript-answers',
  outputType: transcriptAnswerOutput,
  prompt: TRANSCRIPT_ANSWER_PROMPT,
} as const satisfies TranscriptAgent

/**
 * The numbered list, rendered once.
 *
 * convex/call.ts hands this to the assistant as `{{goals}}`, and
 * convex/callExtract.ts hands the same rendering to the answer agent below the
 * transcript. The agent returns a one-based `goalNumber` into it, which
 * convex/call.ts resolves as an index into `calls.gapIds`, so the two lists
 * being numbered identically is what makes an answer land on the right gap.
 * One function, so they cannot be numbered differently.
 */
export function numberedGoals(goals: readonly string[]): string {
  return goals.map((question, i) => `${i + 1}. ${question}`).join('\n')
}
