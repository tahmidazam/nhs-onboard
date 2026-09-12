/**
 * Scores recovered facts against the frozen truth snapshot.
 * Pure: takes data, returns data. No model call, no database access.
 * See ADR 11.
 */
import type { Claim, PatientRecord, RecoveryMetric } from '../../src/types'

export type Truth = Pick<PatientRecord, 'conditions' | 'medications' | 'allergies' | 'immunisations'>

/** The claim fields scoring reads. A stored `claims` document satisfies this without reshaping. */
export type MatchableClaim = Pick<Claim, 'kind' | 'verbatim' | 'resolved' | 'mapping'>

/** Lowercases and strips non-alphanumerics. Shares its rule with `normaliseBrand`. */
function normalise(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** True when two normalised strings share a substring relationship in either direction. */
function substringMatches(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

/** A condition or allergy claim is a hit when its resolved term or verbatim text overlaps the fact. */
function matchesByText(fact: string, claims: MatchableClaim[]): boolean {
  const normalisedFact = normalise(fact)
  return claims.some((claim) => substringMatches(normalisedFact, normalise(claim.resolved ?? claim.verbatim)))
}

/** A medication claim is a hit when its mapped UK ingredient overlaps the fact, never its brand string. */
function matchesByIngredient(fact: string, claims: MatchableClaim[]): boolean {
  const normalisedFact = normalise(fact)
  return claims.some((claim) => {
    const ingredient = claim.mapping?.ukIngredient
    return ingredient !== undefined && substringMatches(normalisedFact, normalise(ingredient))
  })
}

/**
 * Scores a truth snapshot against extracted claims. Immunisations are always
 * synthesised (ADR 8) and are excluded from both `total` and `recovered`.
 */
export function matchRecovery(truth: Truth, claims: MatchableClaim[]): RecoveryMetric {
  const medicationClaims = claims.filter((claim) => claim.kind === 'medication')
  const conditionClaims = claims.filter((claim) => claim.kind === 'condition')
  const allergyClaims = claims.filter((claim) => claim.kind === 'allergy')

  const recoveredMedications = truth.medications.filter((fact) => matchesByIngredient(fact, medicationClaims))
  const recoveredConditions = truth.conditions.filter((fact) => matchesByText(fact, conditionClaims))
  const recoveredAllergies = truth.allergies.filter((fact) => matchesByText(fact, allergyClaims))

  return {
    total: truth.conditions.length + truth.medications.length + truth.allergies.length,
    recovered: recoveredMedications.length + recoveredConditions.length + recoveredAllergies.length,
  }
}
