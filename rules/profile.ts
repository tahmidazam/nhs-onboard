import type { Claim } from '../src/types'
import { normaliseKey } from '../src/lib/normalise'
import type { ImmunisationFact, PatientProfile, ProfileFact } from './types'

/**
 * Builds the one projection every rule reads. Pure: no IO, nothing from Convex,
 * and no wall clock. See docs/adr/0011-recovery-is-measured-against-a-frozen-snapshot.md.
 */

/** The patient fields the projection needs. Narrow on purpose: this module reads nothing else. */
export interface ProfilePatient {
  patientId: string
  birthDate: string
  /** ISO 3166-1 alpha-2, supplied at onboarding. See ADR 9. */
  country: string
}

/** Whole months elapsed, calendar-correct, so an age never depends on month length. */
function monthsBetween(from: string, to: string): number {
  const start = new Date(from)
  const end = new Date(to)
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth())
  // The day-of-month has not come round yet, so the last month is incomplete.
  return end.getUTCDate() < start.getUTCDate() ? months - 1 : months
}

/**
 * A claim's synthesised-ness lives on the document it came from, not on the
 * claim, and this module performs no IO. So the caller passes the ids of the
 * documents it generated. See ADR 8 and ADR 14.
 */
function toFact(claim: Claim, synthesisedDocIds: ReadonlySet<string>): ProfileFact {
  // Medications key on the dm+d UK ingredient, never the brand: "Napa" and
  // "Paracetamol" are the same fact, and ADR 11 scores it that way.
  const resolved = claim.mapping?.ukIngredient ?? claim.resolved

  return {
    key: normaliseKey(resolved ?? claim.verbatim),
    verbatim: claim.verbatim,
    ...(resolved === undefined ? {} : { resolved }),
    confidence: claim.confidence,
    source: claim.source,
    synthesised: synthesisedDocIds.has(claim.source.id),
  }
}

/**
 * The most precise ISO prefix the record states: a full date, a month, or a
 * bare year. Anything vaguer, "as a child" on a degraded vaccination card,
 * yields nothing.
 */
function statedDate(text: string): string | undefined {
  return /\b\d{4}(-\d{2}(-\d{2})?)?\b/.exec(text)?.[0]
}

function statedDoseNumber(text: string): number | undefined {
  const match = /\bdose\s*(\d+)\b/i.exec(text) ?? /\b(\d+)(?:st|nd|rd|th)\s+dose\b/i.exec(text)
  return match ? Number(match[1]) : undefined
}

function toImmunisationFact(
  claim: Claim,
  birthDate: string,
  synthesisedDocIds: ReadonlySet<string>,
): ImmunisationFact {
  const text = claim.resolved ?? claim.verbatim
  const date = statedDate(text)
  const doseNumber = statedDoseNumber(text)

  return {
    ...toFact(claim, synthesisedDocIds),
    ...(date === undefined ? {} : { date }),
    // Undefined is an answer: a month or a year alone cannot settle whether a
    // dose preceded 12 months, and a rule must be able to tell a record that
    // says no from one that does not say.
    ...(date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? { ageAtDoseMonths: monthsBetween(birthDate, date) }
      : {}),
    ...(doseNumber === undefined ? {} : { doseNumber }),
    // givenAbroad stays undefined: no field on a Claim distinguishes a dose
    // given abroad from one given here, and the sim's record covers both.
  }
}

/**
 * Age as a fact a rule can consume. ADR 14 treats age read from the frozen
 * snapshot as a claim like any other, `sim-record` and so `document-evidenced`.
 *
 * The quote is the patient's own birthDate, verbatim from the record. "Aged 52
 * as of 2026-09-12" would be a sentence we composed, and this fact sits under
 * the one recommendation the pack writes back, where the quote is the whole of
 * what a clinician can check.
 *
 * It lives beside the projection rather than in a rule, so every age-driven
 * rule rests on the same fact rather than its own copy of one.
 */
export function ageFact(profile: PatientProfile): ProfileFact {
  return {
    key: 'age',
    verbatim: profile.birthDate,
    confidence: 'document-evidenced',
    source: { kind: 'sim-record', id: profile.patientId, quote: profile.birthDate },
    synthesised: false,
  }
}

/**
 * `synthesisedDocumentIds` names the documents we generated rather than derived
 * from the sim record. It is a parameter because a Claim does not carry the flag
 * and this module does not read documents. See ADR 8.
 */
export function buildProfile(
  patient: ProfilePatient,
  claims: readonly Claim[],
  asOf: string,
  synthesisedDocumentIds: Iterable<string> = [],
): PatientProfile {
  const ageMonths = monthsBetween(patient.birthDate, asOf)
  const synthesisedDocIds = new Set(synthesisedDocumentIds)
  const factsOfKind = (kind: Claim['kind']) =>
    claims.filter((c) => c.kind === kind).map((c) => toFact(c, synthesisedDocIds))

  return {
    patientId: patient.patientId,
    birthDate: patient.birthDate,
    asOf,
    ageYears: Math.floor(ageMonths / 12),
    ageMonths,
    // sex is deliberately left off: the sim carries none, in neither the patient
    // item nor the FHIR projection. A rule needing it emits a Gap.
    country: patient.country,
    conditions: factsOfKind('condition'),
    medications: factsOfKind('medication'),
    allergies: factsOfKind('allergy'),
    // 'family-history' has no slot on the profile: no rule in the pack reads it.
    immunisations: claims
      .filter((c) => c.kind === 'immunisation')
      .map((c) => toImmunisationFact(c, patient.birthDate, synthesisedDocIds)),
  }
}
