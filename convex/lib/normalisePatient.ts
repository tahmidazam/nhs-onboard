/**
 * Turns a captured simulator response into a PatientRecord.
 * Pure: takes data, returns data. No fetching, no database access.
 */
import type { PatientRecord } from '../../src/types'
import type { SimPatientSummary, SimResource } from './simClient'
import { sexFromText, type SexFromText } from './sexFromText'

export interface NormaliseInput {
  patient: SimPatientSummary
  /** Every resource from GET /view for this patient, across all pages. */
  resources: SimResource[]
}

interface EhrRecordData {
  problems?: { code?: string; term?: string; status?: string }[]
  allergies?: { term?: string; substance?: string; reaction?: string }[]
  medications?: { term?: string }[]
}

/** Reads the first present string field, in order, from a loosely-typed entry. */
function pickTerm(entry: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = entry[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * Unions ehr-record.data.problems with sibling `problem` resources, hiding
 * any generated row whose key matches a sibling's sourceProblemKey.
 */
function mergeProblems(ehrRecordId: string, ehr: EhrRecordData, resources: SimResource[]): string[] {
  const siblings = resources.filter((r) => r.kind === 'problem')
  const supersededKeys = new Set(
    siblings.map((r) => r.data.sourceProblemKey).filter((key): key is string => typeof key === 'string'),
  )

  const generated = (ehr.problems ?? [])
    .map((problem, index) => ({ key: `${ehrRecordId}:${index}`, term: pickTerm(problem, ['term']) }))
    .filter((row) => !supersededKeys.has(row.key))
    .map((row) => row.term)
    .filter((term): term is string => Boolean(term))

  const fromSiblings = siblings
    .map((r) => pickTerm(r.data, ['term', 'title']))
    .filter((term): term is string => Boolean(term))

  return dedupe([...generated, ...fromSiblings])
}

/** Unions ehr-record.data.allergies with sibling `allergy` resources. */
function mergeAllergies(ehr: EhrRecordData, resources: SimResource[]): string[] {
  const fromRecord = (ehr.allergies ?? [])
    .map((allergy) => pickTerm(allergy, ['term', 'substance']))
    .filter((term): term is string => Boolean(term))

  const fromSiblings = resources
    .filter((r) => r.kind === 'allergy')
    .map((r) => pickTerm(r.data, ['term', 'substance', 'title']))
    .filter((term): term is string => Boolean(term))

  return dedupe([...fromRecord, ...fromSiblings])
}

function readMedications(ehr: EhrRecordData): string[] {
  return dedupe(
    (ehr.medications ?? [])
      .map((medication) => pickTerm(medication, ['term']))
      .filter((term): term is string => Boolean(term)),
  )
}

export function normalisePatient({ patient, resources }: NormaliseInput): PatientRecord {
  const ehrRecord = resources.find((r) => r.kind === 'ehr-record')
  const ehr: EhrRecordData = (ehrRecord?.data as EhrRecordData) ?? {}

  return {
    id: patient.id,
    name: patient.name,
    birthDate: patient.birthDate,
    conditions: ehrRecord ? mergeProblems(ehrRecord.id, ehr, resources) : [],
    medications: readMedications(ehr),
    allergies: mergeAllergies(ehr, resources),
    /** The sim carries no immunisation data. See ADR 8. */
    immunisations: [],
    raw: resources,
  }
}

/* -------------------------------------------------------------------------- */
/* Sex, which the sim holds only in prose. See ADR 20.                          */
/* -------------------------------------------------------------------------- */

/**
 * The kinds whose `data.text` is narrative prose about the patient.
 *
 * Narrow on purpose. `discharge-summary.data.sections` is prose too, and it
 * names staff: "The discharge coordinator recorded the handover" is a sentence
 * a clinician's pronoun can appear in, and a pronoun that is not the patient's
 * is worse than no pronoun. `message-template.body` is a template addressed to
 * the patient in the second person, so it carries no third-person pronoun to
 * read and no guarantee the one it carries is about this patient.
 *
 * These two are also the two CONTEXT.md verified by sampling the population:
 * 16 female pronouns on SIM-000001, 14 male on SIM-000002, none on
 * SIM-000015.
 */
const NARRATIVE_KINDS = new Set(['encounter', 'observation'])

/**
 * The patient's narrative, one resource per line, in the order `GET /view`
 * returned them. Line-joined rather than space-joined so a sentence never
 * straddles two resources: `sexFromText` quotes a sentence, and a quote
 * spanning two encounters would be a sentence neither of them says.
 */
export function narrativeText(resources: SimResource[]): string {
  return resources
    .filter((resource) => NARRATIVE_KINDS.has(resource.kind))
    .map((resource) => (typeof resource.data.text === 'string' ? resource.data.text.trim() : ''))
    .filter((text) => text.length > 0)
    .join('\n')
}

/**
 * Sex as the sim's own narrative states it, with the sentence stating it.
 *
 * Separate from `normalisePatient` rather than a field on `PatientRecord`,
 * because `PatientRecord` is the answer key ADR 11 freezes and scores recovery
 * against. Sex has no entry in it: the sim holds no sex field, so there is
 * nothing for RecoveryMetric to have recovered and nothing it could score. It
 * is identity, and it lands on `patients.sex` beside `name` and `country`.
 *
 * Undefined for a patient the sim wrote no pronouns for, or wrote both for.
 * That is the common case, and it is a Gap for the call rather than a failure.
 */
export function sexFromNarrative(resources: SimResource[]): SexFromText | undefined {
  return sexFromText(narrativeText(resources))
}
