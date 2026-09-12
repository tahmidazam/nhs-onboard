import type { ProfileFact } from './types'

/**
 * The documented-negative predicate: which of the facts a rule reads actually
 * state something.
 *
 * Our own degrader fills an emptied section with a sentence rather than leaving
 * it blank. "Patient could not recall any known drug allergies." when no
 * allergy survives the draw, "No further history recorded at this visit." when
 * no condition does, "Patient reports taking regular medication abroad but
 * could not name it." when no medication does. All three are written in
 * convex/lib/degradeRecord.ts, and all three are produced by loss rather than
 * by a real negative: the truth array had entries and the dice dropped them.
 *
 * Extraction reads the sentence back as a Claim, so `profile.allergies` can be
 * non-empty while the record states no allergy at all. A documented negative is
 * not a negative. Treating "could not recall any known drug allergies" as an
 * absence of allergy is how a false "no known allergies" reaches a UK
 * prescriber, and it is worse than a blank record because it looks answered.
 *
 * `rules/` imports nothing from `convex/` per ADR 13, so the three sentences are
 * not shared with the degrader. rules/negation.test.ts names them verbatim with
 * a pointer at convex/lib/degradeRecord.ts, and that test is the only thing
 * keeping the two copies honest.
 *
 * The patterns are anchored or phrase-specific and never a loose `\bno\b`,
 * which would eat "Nuts, no reaction known" and drop a real allergy out of
 * `stated` silently.
 *
 * Where the call is close it goes to documented-negative, because the two
 * errors are not symmetric. A real allergy read as a negative costs one extra
 * open question on a call we are already making, and the fact still reaches the
 * problem list through nhs-record-allergy, which reads `profile.allergies`
 * whole. A negative read as a real allergy stops nhs-ask-allergies firing, and
 * the absence is then written onto a medical record unchallenged.
 */

/** A section heading the extraction may have carried in with the sentence. */
const SECTION_LABEL =
  /^(?:drug allerg(?:y|ies)|allerg(?:y|ies)|past medical history|medical history|drug history|history|medications?|medicines?|pmh|dh|fh|sh)\s*[:–—-]\s*/

/**
 * Lower-cased, apostrophes and quotes dropped, whitespace collapsed, one
 * leading heading or bullet removed, trailing sentence punctuation removed. So
 * "Allergies: Patient couldn't recall any known drug allergies." and the bare
 * sentence normalise to the same string, and both anchor.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(SECTION_LABEL, '')
    .replace(/^[-–—*•\s]+/, '')
    .replace(/[.;,!\s]+$/, '')
    .trim()
}

/**
 * Anchored: the whole fact has to be the negative. The first three are the
 * degrader's own sentences, widened only over the words an extraction plausibly
 * drops or swaps, never over what they are about. The rest are the
 * blank-equivalents a real record writes instead of leaving a field empty, and
 * a fact whose entire text is one of them states nothing whatever section it
 * came from.
 */
const WHOLE: readonly RegExp[] = [
  /^(?:the )?patient (?:could not|couldnt|cannot|cant|did not|didnt|was unable to|is unable to) (?:recall|remember|name|report|give|provide) (?:any )?(?:known )?(?:drug |medicine |medication )?allerg(?:y|ies)$/,
  /^no (?:further |significant |relevant |other |additional |past )*(?:medical )?history (?:recorded|reported|documented|available|given|noted)(?: at this visit| at this time| today| on record)?$/,
  /^(?:the )?patient (?:reports )?(?:taking )?(?:regular )?medications? abroad but (?:could not|couldnt|cannot|did not|didnt) name (?:it|them|any|either)$/,

  /^(?:nil|none|nka|nkda|unknown|not known|not recorded|none recorded|none known|not applicable|n\/a|nil of note|nil known|no record|no records|unremarkable|nothing of note)$/,
  /^(?:no|nil|none) known (?:drug |medicine |medication )?allerg(?:y|ies)$/,
  /^(?:no|nil|none)(?: known)? allerg(?:y|ies)(?: known| reported| recorded| documented| identified)?$/,
  /^(?:patient )?denies (?:any )?(?:known )?(?:drug )?allerg(?:y|ies)$/,
  /^(?:no|nil|none)(?: regular| current| repeat| known)? medications?(?: known| reported| recorded| listed| taken)?$/,
  /^medications? (?:unknown|not known|not recorded|could not be named)$/,
  /^(?:no|nil|none)(?: significant| relevant| past| further)* (?:medical )?history$/,
  /^(?:no|nil|none) known family history$/,
  /^(?:no|nil|none) (?:family history|conditions?|problems?|diagnos(?:is|es))(?: known| reported| recorded)?$/,
]

/**
 * Contained rather than anchored, for the case where extraction quoted the
 * sentence inside a longer span. Each one is specific enough that it cannot
 * occur inside a fact that states something, with one exception: "Penicillin,
 * patient could not recall the reaction" reads as a negative here and is the
 * false positive the header prefers. It costs an open question on the call and
 * loses no allergy from the record.
 */
const PHRASES: readonly RegExp[] = [
  /\b(?:could not|couldnt|cannot|cant|did not|didnt|unable to) (?:recall|remember|name)\b/,
  /\bno known (?:drug |medicine |medication )?allerg(?:y|ies)\b/,
  /\bnil known allerg(?:y|ies)\b/,
  /\bdenies (?:any )?(?:known )?(?:drug )?allerg(?:y|ies)\b/,
  /\bno allergies (?:known|reported|recorded)\b/,
  /\bno further history recorded\b/,
  /\bnot recorded at this visit\b/,
]

function isNegativeText(text: string): boolean {
  const normalised = normalise(text)
  // A fact whose text is empty once the heading comes off states nothing either.
  if (normalised.length === 0) return true
  return WHOLE.some((p) => p.test(normalised)) || PHRASES.some((p) => p.test(normalised))
}

/**
 * Reads both `verbatim` and `resolved`, because either can be the sentence: ADR
 * 18 puts translation in the recovery path, so a negative can arrive verbatim
 * in the source language and resolved into English, or arrive in English and
 * resolve to a coded term. Either one reading as a negative is enough.
 */
export function isDocumentedNegative(fact: ProfileFact): boolean {
  if (isNegativeText(fact.verbatim)) return true
  return fact.resolved !== undefined && isNegativeText(fact.resolved)
}

/** The facts that actually state something. What a gap rule counts. */
export function stated(facts: readonly ProfileFact[]): ProfileFact[] {
  return facts.filter((fact) => !isDocumentedNegative(fact))
}
