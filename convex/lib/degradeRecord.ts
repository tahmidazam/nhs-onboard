/**
 * Turns a frozen PatientRecord into English PresentedDocuments.
 * Pure: takes data, returns data. No fetching, no database access, no model
 * call. See docs/adr/0010-degrader-is-template-driven.md.
 *
 * Every clinical string this module writes is either a verbatim entry from
 * `record` or a substring of one. Non-clinical furniture (clinic name,
 * reference number) comes from the fixed lists below.
 */
import type { PatientRecord } from '../../src/types'
import { LOSS_RATES } from './degradeConstants'

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

function renderCondition(term: string, coded: boolean): string {
  return coded ? `Known diagnosis: ${term}.` : `Patient describes ongoing issues consistent with ${term}.`
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
function degradeConditions(conditions: string[], rng: () => number): CategoryResult {
  const lines: string[] = []
  const facts: string[] = []
  for (const term of conditions) {
    if (rng() > LOSS_RATES.condition.survives) continue
    const coded = rng() < LOSS_RATES.condition.attributes.codedDiagnosis
    lines.push(renderCondition(term, coded))
    facts.push(term)
  }
  return { lines, facts }
}

function degradeAllergies(allergies: string[], rng: () => number): CategoryResult {
  const lines: string[] = []
  const facts: string[] = []
  for (const raw of allergies) {
    if (rng() > LOSS_RATES.allergy.survives) continue
    const { substance, reaction } = splitAllergy(raw)
    const keepReaction = reaction !== undefined && rng() < LOSS_RATES.allergy.attributes.reaction
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

function degradeMedications(medications: string[], rng: () => number): MedicationResult {
  const lines: string[] = []
  const facts: string[] = []
  const names: string[] = []
  for (const raw of medications) {
    if (rng() > LOSS_RATES.medication.survives) continue
    const { name, dose, frequency } = splitMedication(raw)
    const keepDose = dose !== undefined && rng() < LOSS_RATES.medication.attributes.dose
    const keepFrequency = frequency !== undefined && rng() < LOSS_RATES.medication.attributes.frequency

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

function renderClinicLetter(record: PatientRecord, rng: () => number, conditionLines: string[], allergyLines: string[]): string {
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
 */
export function degradeRecord(record: PatientRecord, country: string, seed: string): DegradeResult {
  const rng = seededRandom(seed)
  const documents: DegradedDocument[] = []

  if (record.conditions.length > 0 || record.allergies.length > 0) {
    const conditions = degradeConditions(record.conditions, rng)
    const allergies = degradeAllergies(record.allergies, rng)
    documents.push({
      kind: 'clinic-letter',
      language: 'en',
      country,
      text: renderClinicLetter(record, rng, conditions.lines, allergies.lines),
      facts: [...conditions.facts, ...allergies.facts],
    })
  }

  if (record.medications.length > 0) {
    const medications = degradeMedications(record.medications, rng)
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
