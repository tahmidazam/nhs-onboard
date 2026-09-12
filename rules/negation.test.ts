import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { isDocumentedNegative, stated } from './negation'
import type { ProfileFact } from './types'

/**
 * The three sentences below are the degrader's, verbatim. They are written in
 * convex/lib/degradeRecord.ts, in renderClinicLetter and
 * renderPrescriptionList, and ADR 13 forbids `rules/` importing from `convex/`,
 * so this file holds the second copy. If a sentence there is reworded and these
 * do not go red, the gap rules stop firing on a record that says nothing and
 * the pipeline writes a false "no known allergies" onto a UK record.
 */

/** convex/lib/degradeRecord.ts, renderClinicLetter, when no allergy survives. */
const DEGRADER_ALLERGIES = 'Patient could not recall any known drug allergies.'

/** convex/lib/degradeRecord.ts, renderClinicLetter, when no condition survives. */
const DEGRADER_HISTORY = 'No further history recorded at this visit.'

/** convex/lib/degradeRecord.ts, renderPrescriptionList, when no medication survives. */
const DEGRADER_MEDICATIONS =
  'Patient reports taking regular medication abroad but could not name it.'

function fact(verbatim: string, resolved?: string): ProfileFact {
  return {
    key: verbatim.toLowerCase().replace(/[^a-z0-9]/g, ''),
    verbatim,
    ...(resolved === undefined ? {} : { resolved }),
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'doc-1', quote: verbatim },
    synthesised: false,
  }
}

describe('the three sentences the degrader writes into an emptied section', () => {
  it('reads all three as documented negatives', () => {
    for (const sentence of [DEGRADER_ALLERGIES, DEGRADER_HISTORY, DEGRADER_MEDICATIONS]) {
      assert.ok(isDocumentedNegative(fact(sentence)), sentence)
    }
  })

  it('reads them the same way when the extraction dropped the full stop', () => {
    for (const sentence of [DEGRADER_ALLERGIES, DEGRADER_HISTORY, DEGRADER_MEDICATIONS]) {
      assert.ok(isDocumentedNegative(fact(sentence.replace(/\.$/, ''))), sentence)
    }
  })

  it('reads them the same way when the extraction carried the section heading in', () => {
    assert.ok(isDocumentedNegative(fact(`Allergies: ${DEGRADER_ALLERGIES}`)))
    assert.ok(isDocumentedNegative(fact(`History: ${DEGRADER_HISTORY}`)))
    assert.ok(isDocumentedNegative(fact(`Medications: ${DEGRADER_MEDICATIONS}`)))
  })

  it('takes all three out of stated, leaving a section that says nothing empty', () => {
    assert.deepEqual(
      stated([fact(DEGRADER_ALLERGIES), fact(DEGRADER_HISTORY), fact(DEGRADER_MEDICATIONS)]),
      [],
    )
  })
})

describe('a fact that actually states something', () => {
  it('keeps an allergy whose reaction is the word no', () => {
    // The reason the patterns are anchored rather than a `\bno\b` search. This
    // fact names a substance, so the record does say something about allergy.
    const nuts = fact('Nuts, no reaction known')
    assert.equal(isDocumentedNegative(nuts), false)
    assert.deepEqual(stated([nuts]), [nuts])
  })

  it('keeps an allergy the degrader rendered from a surviving entry', () => {
    for (const line of [
      'Allergic to Penicillin.',
      'Allergic to Penicillin, reaction: rash.',
      'Penicillin (rash)',
    ]) {
      assert.equal(isDocumentedNegative(fact(line)), false, line)
    }
  })

  it('keeps a condition the degrader rendered from a surviving entry', () => {
    for (const line of [
      'Known diagnosis: Type 2 diabetes mellitus.',
      'Patient describes ongoing issues consistent with essential hypertension.',
    ]) {
      assert.equal(isDocumentedNegative(fact(line)), false, line)
    }
  })

  it('keeps a medication the record named, however little else it carried', () => {
    for (const line of ['Napa 500mg', 'Metfo', 'Unknown white tablet', 'Nomega 3']) {
      assert.equal(isDocumentedNegative(fact(line)), false, line)
    }
  })
})

describe('the blank-equivalents a real record writes instead of an empty field', () => {
  it('reads the bare ones as negatives', () => {
    for (const line of [
      'Nil',
      'None',
      'NKDA',
      'No known allergies',
      'No known drug allergies',
      'Nil of note',
      'No regular medications',
      'Medications unknown',
      'No significant past medical history',
      'No known family history',
      'Not recorded',
    ]) {
      assert.ok(isDocumentedNegative(fact(line)), line)
    }
  })

  it('reads a fact whose text is nothing but a heading as a negative', () => {
    assert.ok(isDocumentedNegative(fact('Allergies:')))
    assert.ok(isDocumentedNegative(fact('   ')))
  })
})

describe('which of verbatim and resolved the predicate reads', () => {
  it('reads the negative off resolved when the source language carried it', () => {
    // ADR 18 puts translation in the recovery path, so the negative can arrive
    // in the source language and only read as one once resolved.
    assert.ok(isDocumentedNegative(fact('Aucune allergie connue', 'No known allergies')))
  })

  it('reads the negative off verbatim when the mapping resolved it to something else', () => {
    assert.ok(isDocumentedNegative(fact(DEGRADER_MEDICATIONS, 'Medication, unspecified')))
  })

  it('needs neither to be a negative before it keeps the fact', () => {
    assert.equal(isDocumentedNegative(fact('penicilina', 'Penicillin')), false)
  })
})

describe('stated', () => {
  it('returns the stating facts in the order they were read', () => {
    const penicillin = fact('Allergic to Penicillin.')
    const nuts = fact('Nuts, no reaction known')
    assert.deepEqual(
      stated([fact(DEGRADER_ALLERGIES), penicillin, fact('NKDA'), nuts]),
      [penicillin, nuts],
    )
  })

  it('leaves the array it was given alone, so a rule cannot move the profile', () => {
    const facts = [fact(DEGRADER_ALLERGIES), fact('Allergic to Penicillin.')]
    const before = structuredClone(facts)
    stated(facts)
    assert.deepEqual(facts, before)
  })

  it('returns an empty array for an empty one, which is the thin record', () => {
    assert.deepEqual(stated([]), [])
  })
})
