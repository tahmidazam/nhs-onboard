/**
 * Turns a captured simulator response into a PatientRecord.
 * Pure: takes data, returns data. No fetching, no database access.
 */
import type { PatientRecord } from '../../src/types'
import type { SimPatientSummary, SimResource } from './simClient'

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
