/**
 * Scores recovered facts against the frozen truth snapshot.
 * Pure: takes data, returns data. No model call, no database access.
 * See ADR 11.
 */
import type { Claim, PatientRecord, RecoveryMetric } from '../../src/types'

export type Truth = Pick<PatientRecord, 'conditions' | 'medications' | 'allergies' | 'immunisations'>

/** The claim fields scoring reads. A stored `claims` document satisfies this without reshaping. */
export type MatchableClaim = Pick<Claim, 'kind' | 'verbatim' | 'resolved' | 'mapping' | 'source'>

/**
 * True when a claim may count towards the numerator. See ADR 17.
 *
 * A `document` claim counts only once its quote has anchored by containment, so
 * the absence of a verdict is a failure: nothing checked it.
 *
 * Every other kind is admitted unless something checked it and said no. That
 * asymmetry is deliberate. `sim-record` claims carry no quote and no `verified`
 * field, and so do the transcript claims written before the call read anything.
 * But a transcript claim now carries a verdict too: convex/callExtract.ts
 * anchors its quote against the patient's own turns, and a quote lifted from
 * the assistant's mouth fails. The assistant reads every drug name and dose
 * back out loud twice under the verification ladder, so a claim quoted from a
 * readback is our own guess laundered into the record, which is ADR 17's stated
 * failure mode arriving by voice. It is kept and shown, per ADR 3, and it does
 * not score. See ADR 22.
 */
export function isAnchored(claim: MatchableClaim): boolean {
  if (claim.source.kind === 'document') return claim.source.verified === true
  return claim.source.verified !== false
}

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

/** One fact from the truth snapshot with the verdict the matcher reached on it. */
export interface ScoredFact {
  kind: 'condition' | 'medication' | 'allergy'
  fact: string
  recovered: boolean
}

export interface RecoveryDetail extends RecoveryMetric {
  facts: ScoredFact[]
}

/**
 * Scores a truth snapshot against extracted claims, naming every fact.
 * Immunisations are always synthesised (ADR 8) and appear nowhere here.
 * Unanchored claims cannot recover a fact; the snapshot is unaffected by
 * them, so a fact they alone would have matched stays missed. See ADR 17.
 */
export function recoveryDetail(truth: Truth, claims: MatchableClaim[]): RecoveryDetail {
  // Filtered once, before the per-kind splits: an unanchored claim is one the
  // extractor may have manufactured, and must not score as a recovered fact.
  const anchored = claims.filter(isAnchored)

  const scoreAll = (
    kind: ScoredFact['kind'],
    facts: string[],
    matches: (fact: string, claims: MatchableClaim[]) => boolean,
  ): ScoredFact[] => {
    const ofKind = anchored.filter((claim) => claim.kind === kind)
    return facts.map((fact) => ({ kind, fact, recovered: matches(fact, ofKind) }))
  }

  const facts = [
    ...scoreAll('condition', truth.conditions, matchesByText),
    ...scoreAll('medication', truth.medications, matchesByIngredient),
    ...scoreAll('allergy', truth.allergies, matchesByText),
  ]

  return {
    total: facts.length,
    recovered: facts.filter((scored) => scored.recovered).length,
    facts,
  }
}

/** The counts alone, for the board column and the stored metric. */
export function matchRecovery(truth: Truth, claims: MatchableClaim[]): RecoveryMetric {
  const { total, recovered } = recoveryDetail(truth, claims)
  return { total, recovered }
}
