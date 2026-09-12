/**
 * Turns a frozen PatientRecord into English PresentedDocuments.
 * Pure: takes data, returns data. No fetching, no database access, no model
 * call. See docs/adr/0010-degrader-is-template-driven.md.
 *
 * Every clinical string this module writes is either a verbatim entry from
 * `record` or a substring of one. Non-clinical furniture is invented: the
 * clinic name and the reference number, which ADR 10 licenses as the noise
 * that makes a document look like a document.
 *
 * The pronoun is neither of those two things, so be exact about it. It is not
 * a substring of `record`'s truth arrays, and it is not invented here: it
 * comes from `patients.sex`, which ADR 20 read out of the simulator's own
 * narrative text at onboarding. It is a fact the sim holds, arriving through a
 * field rather than through `truth`, and the caller passes it in. Nothing in
 * this module draws it, because a pronoun that disagreed with the name on the
 * letter would read as a bug rather than as a degraded record.
 *
 * `sex` omitted is the honest default and the common one: the sim writes
 * pronouns for some patients only, and a letter about a patient whose record
 * never said reverts to the pronoun-free templates and says nothing either.
 * Sex is then a Gap for the call, per ADR 20.
 */
import type { PatientRecord, PatientSex } from '../../src/types'
import { LOSS_RATES, type LossTable } from './degradeConstants'

export type DegradedDocumentKind = 'clinic-letter' | 'prescription-list'

export interface DegradedDocument {
  kind: DegradedDocumentKind
  /** BCP-47. Always 'en' here; translation is a later stage. */
  language: string
  /** ISO 3166-1 alpha-2. */
  country: string
  text: string
  /** Verbatim substrings of `record`'s truth arrays. Used by the containment test. */
  facts: string[]
  /** Drug-name portion of each surviving medication. Set on prescription-list only. */
  medicationNames?: string[]
}

export interface DegradeResult {
  documents: DegradedDocument[]
}

interface Pronouns {
  /** Sentence-initial, which is where the condition templates put it. */
  subject: string
  possessive: string
}

const PRONOUNS: Record<PatientSex['value'], Pronouns> = {
  male: { subject: 'He', possessive: 'his' },
  female: { subject: 'She', possessive: 'her' },
}

const CLINIC_NAMES = [
  'Green Valley Medical Centre',
  'Riverside Family Clinic',
  'St Augustine General Hospital',
  'Sunrise Community Health Centre',
  'Lakeside Polyclinic',
  'Union Diagnostic and Medical Centre',
]

const REFERENCE_PREFIXES = ['REF', 'PT', 'MRN', 'CL']

/** Deterministic PRNG seeded from a string, so a patient degrades identically every run. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function random() {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]
}

function referenceNumber(rng: () => number): string {
  return `${pick(rng, REFERENCE_PREFIXES)}-${Math.floor(rng() * 900000 + 100000)}`
}

const DOSE_PATTERN = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|iu)\b/i
const FREQUENCY_PATTERN =
  /\b(?:once|twice|three times|four times)\s+(?:a|per)\s+day\b|\b(?:od|bd|tds|qds|nocte|mane|prn)\b/i

/**
 * Splits a raw medication string into its name and any embedded dose or
 * frequency, so losing an attribute means dropping a substring of the
 * original rather than inventing structure the snapshot never carried.
 */
function splitMedication(raw: string): { name: string; dose?: string; frequency?: string } {
  let name = raw
  const doseMatch = raw.match(DOSE_PATTERN)
  const dose = doseMatch?.[0]
  if (dose) name = name.replace(dose, '')

  const freqMatch = raw.match(FREQUENCY_PATTERN)
  const frequency = freqMatch?.[0]
  if (frequency) name = name.replace(frequency, '')

  name = name.replace(/\s{2,}/g, ' ').trim().replace(/[,;-]+$/, '').trim()
  return { name: name || raw.trim(), dose, frequency }
}

/** Reads a bracketed reaction off a raw allergy string, e.g. "Penicillin (rash)". */
function splitAllergy(raw: string): { substance: string; reaction?: string } {
  const match = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (match) return { substance: match[1].trim(), reaction: match[2].trim() }
  return { substance: raw.trim() }
}

/**
 * `term` is verbatim from the snapshot in all four forms. Only the subject
 * changes: a pronoun where ADR 20 established one, and "Patient" where it did
 * not, which is what the pronoun-free record should read like.
 */
function renderCondition(term: string, coded: boolean, pronouns?: Pronouns): string {
  if (!pronouns) {
    return coded ? `Known diagnosis: ${term}.` : `Patient describes ongoing issues consistent with ${term}.`
  }
  return coded
    ? `${pronouns.subject} has a known diagnosis of ${term}.`
    : `${pronouns.subject} describes ongoing issues consistent with ${term}.`
}

interface CategoryResult {
  lines: string[]
  facts: string[]
}

/**
 * Every condition in `record.truth` is presented, whether or not the sim
 * still marks it active: a migrating record does not reliably carry
 * resolution either. See CONTEXT.md's known gaps section.
 */
function degradeConditions(
  conditions: string[],
  rng: () => number,
  loss: LossTable,
  pronouns?: Pronouns,
): CategoryResult {
  const lines: string[] = []
  const facts: string[] = []
  for (const term of conditions) {
    if (rng() > loss.condition.survives) continue
    const coded = rng() < loss.condition.attributes.codedDiagnosis
    lines.push(renderCondition(term, coded, pronouns))
    facts.push(term)
  }
  return { lines, facts }
}

function degradeAllergies(allergies: string[], rng: () => number, loss: LossTable): CategoryResult {
  const lines: string[] = []
  const facts: string[] = []
  for (const raw of allergies) {
    if (rng() > loss.allergy.survives) continue
    const { substance, reaction } = splitAllergy(raw)
    const keepReaction = reaction !== undefined && rng() < loss.allergy.attributes.reaction
    lines.push(keepReaction ? `Allergic to ${substance}, reaction: ${reaction}.` : `Allergic to ${substance}.`)
    facts.push(substance)
    if (keepReaction) facts.push(reaction)
  }
  return { lines, facts }
}

interface MedicationResult extends CategoryResult {
  /** The drug-name portion of each surviving medication, for the brand rendering pass in #8. */
  names: string[]
}

function degradeMedications(medications: string[], rng: () => number, loss: LossTable): MedicationResult {
  const lines: string[] = []
  const facts: string[] = []
  const names: string[] = []
  for (const raw of medications) {
    if (rng() > loss.medication.survives) continue
    const { name, dose, frequency } = splitMedication(raw)
    const keepDose = dose !== undefined && rng() < loss.medication.attributes.dose
    const keepFrequency = frequency !== undefined && rng() < loss.medication.attributes.frequency

    const parts = [name]
    if (keepDose) parts.push(dose)
    if (keepFrequency) parts.push(frequency)
    lines.push(`- ${parts.join(' ')}`)

    facts.push(name)
    if (keepDose) facts.push(dose)
    if (keepFrequency) facts.push(frequency)
    names.push(name)
  }
  return { lines, facts, names }
}

function renderClinicLetter(
  record: PatientRecord,
  rng: () => number,
  conditionLines: string[],
  allergyLines: string[],
  pronouns?: Pronouns,
): string {
  return [
    pick(rng, CLINIC_NAMES),
    `Reference: ${referenceNumber(rng)}`,
    `Patient: ${record.name}`,
    `Date of birth: ${record.birthDate}`,
    '',
    'History:',
    ...(conditionLines.length ? conditionLines : ['No further history recorded at this visit.']),
    '',
    'Allergies:',
    ...(allergyLines.length ? allergyLines : ['Patient could not recall any known drug allergies.']),
    // Administrative, and the one line that does not depend on what survived
    // the loss table. A record whose every condition was lost still reads as a
    // record about a person.
    ...(pronouns
      ? [
          '',
          `Please contact the clinic if ${pronouns.subject.toLowerCase()} requires a copy of ${pronouns.possessive} records.`,
        ]
      : []),
  ].join('\n')
}

function renderPrescriptionList(record: PatientRecord, rng: () => number, medicationLines: string[]): string {
  return [
    `${pick(rng, CLINIC_NAMES)} — Prescription list`,
    `Reference: ${referenceNumber(rng)}`,
    `Patient: ${record.name} (DOB ${record.birthDate})`,
    '',
    'Medications:',
    ...(medicationLines.length ? medicationLines : ['Patient reports taking regular medication abroad but could not name it.']),
  ].join('\n')
}

/**
 * Degrades one patient's frozen snapshot into English PresentedDocuments.
 * Seeded, so the same `seed` (the patient's sim id) always produces the same
 * output. A category with nothing in the snapshot produces no document.
 *
 * `sex` renders the clinic letter in the third person, and is the only
 * argument that is not part of the frozen snapshot. Omitted, the letter reads
 * exactly as it did before ADR 20.
 *
 * `loss` defaults to the shipped table. The operator's severity dial passes a
 * scaled copy, which changes how much survives without changing the draws:
 * the same seed at two severities still reads as the same record, degraded
 * further.
 */
export function degradeRecord(
  record: PatientRecord,
  country: string,
  seed: string,
  loss: LossTable = LOSS_RATES,
  /** From `patients.sex`, itself read off the sim's narrative. Absent where the sim never said. */
  sex?: PatientSex['value'],
): DegradeResult {
  const rng = seededRandom(seed)

  /**
   * Consumes no draw, which is the point. `sex` arrives from outside the
   * generator, so adding it moved no existing patient's document: the same
   * seed still makes the same loss decisions in the same order, at every
   * severity. See ADR 10 on reproducibility.
   */
  const pronouns = sex ? PRONOUNS[sex] : undefined

  const documents: DegradedDocument[] = []

  if (record.conditions.length > 0 || record.allergies.length > 0) {
    const conditions = degradeConditions(record.conditions, rng, loss, pronouns)
    const allergies = degradeAllergies(record.allergies, rng, loss)
    documents.push({
      kind: 'clinic-letter',
      language: 'en',
      country,
      text: renderClinicLetter(record, rng, conditions.lines, allergies.lines, pronouns),
      facts: [...conditions.facts, ...allergies.facts],
    })
  }

  if (record.medications.length > 0) {
    const medications = degradeMedications(record.medications, rng, loss)
    documents.push({
      kind: 'prescription-list',
      language: 'en',
      country,
      text: renderPrescriptionList(record, rng, medications.lines),
      facts: medications.facts,
      medicationNames: medications.names,
    })
  }

  return { documents }
}
