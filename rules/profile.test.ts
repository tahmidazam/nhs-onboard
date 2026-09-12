import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { Claim } from '../src/types'
import { ageFact, buildProfile } from './profile'

/**
 * The profile builder. See #13.
 *
 * Every assertion is on the returned profile, never on how it was reached.
 */

const patient = { patientId: 'p1', birthDate: '1974-03-15', country: 'BD' }

/** The frozen sim clock. Nothing here may read a wall clock. */
const asOf = '2026-09-12T08:00:00Z'

function claim(over: Partial<Claim>): Claim {
  return {
    id: 'c1',
    patientId: 'p1',
    kind: 'condition',
    verbatim: 'ডায়াবেটিস',
    confidence: 'document-evidenced',
    source: { kind: 'document', id: 'd1', quote: 'ডায়াবেটিস' },
    ...over,
  }
}

describe('buildProfile', () => {
  it('derives age from asOf rather than a wall clock', () => {
    const profile = buildProfile(patient, [], asOf)

    assert.equal(profile.ageYears, 52)
    assert.equal(profile.ageMonths, 629)
    assert.equal(profile.asOf, asOf)
  })

  it('carries the patient id and supplied country through', () => {
    const profile = buildProfile(patient, [], asOf)

    assert.equal(profile.patientId, 'p1')
    assert.equal(profile.country, 'BD')
  })

  it('carries the birthDate through, so an age-driven rule can quote it', () => {
    assert.equal(buildProfile(patient, [], asOf).birthDate, '1974-03-15')
  })

  it('leaves sex absent, because the sim holds none', () => {
    assert.equal(buildProfile(patient, [], asOf).sex, undefined)
  })

  it('keys a resolved condition on its UK term and keeps the verbatim', () => {
    const profile = buildProfile(
      patient,
      [claim({ kind: 'condition', verbatim: 'ডায়াবেটিস', resolved: 'Type 2 diabetes mellitus' })],
      asOf,
    )

    assert.equal(profile.conditions.length, 1)
    assert.deepEqual(profile.conditions[0], {
      key: 'type2diabetesmellitus',
      verbatim: 'ডায়াবেটিস',
      resolved: 'Type 2 diabetes mellitus',
      confidence: 'document-evidenced',
      source: { kind: 'document', id: 'd1', quote: 'ডায়াবেটিস' },
      synthesised: false,
    })
  })

  it('keys an unresolved condition on its verbatim', () => {
    const profile = buildProfile(patient, [claim({ verbatim: 'Asthma (mild)' })], asOf)

    assert.equal(profile.conditions[0]?.key, 'asthmamild')
    assert.equal(profile.conditions[0]?.resolved, undefined)
  })

  it('preserves each claim confidence and source onto its fact', () => {
    const profile = buildProfile(
      patient,
      [
        claim({
          kind: 'allergy',
          verbatim: 'penicillin',
          confidence: 'patient-reported',
          source: { kind: 'transcript', id: 'call-7', quote: 'I react to penicillin' },
        }),
      ],
      asOf,
    )

    assert.equal(profile.allergies[0]?.confidence, 'patient-reported')
    assert.deepEqual(profile.allergies[0]?.source, {
      kind: 'transcript',
      id: 'call-7',
      quote: 'I react to penicillin',
    })
  })

  it('sorts claims into the profile by kind and drops what the profile has no slot for', () => {
    const profile = buildProfile(
      patient,
      [
        claim({ id: 'a', kind: 'condition', verbatim: 'diabetes' }),
        claim({ id: 'b', kind: 'medication', verbatim: 'Napa' }),
        claim({ id: 'c', kind: 'allergy', verbatim: 'penicillin' }),
        claim({ id: 'd', kind: 'immunisation', verbatim: 'BCG' }),
        claim({ id: 'e', kind: 'family-history', verbatim: 'mother had breast cancer' }),
      ],
      asOf,
    )

    assert.deepEqual(
      {
        conditions: profile.conditions.map((f) => f.verbatim),
        medications: profile.medications.map((f) => f.verbatim),
        allergies: profile.allergies.map((f) => f.verbatim),
        immunisations: profile.immunisations.map((f) => f.verbatim),
      },
      {
        conditions: ['diabetes'],
        medications: ['Napa'],
        allergies: ['penicillin'],
        immunisations: ['BCG'],
      },
    )
  })

  it('keys a medication on the dm+d UK ingredient, not the brand', () => {
    const profile = buildProfile(
      patient,
      [
        claim({
          kind: 'medication',
          verbatim: 'নাপা ৫০০',
          confidence: 'uncertain-mapping',
          mapping: {
            brand: 'Napa',
            generic: 'Paracetamol',
            ukIngredient: 'Paracetamol',
            prescribable: 'Paracetamol 500mg tablets',
            via: 'bd-medex',
            unresolved: false,
          },
        }),
      ],
      asOf,
    )

    assert.equal(profile.medications[0]?.key, 'paracetamol')
    assert.equal(profile.medications[0]?.resolved, 'Paracetamol')
    assert.equal(profile.medications[0]?.verbatim, 'নাপা ৫০০')
  })

  it('computes age at dose from a fully dated immunisation', () => {
    const profile = buildProfile(
      patient,
      [
        claim({
          kind: 'immunisation',
          verbatim: 'Measles vaccine 1974-12-20',
          source: { kind: 'document', id: 'card', quote: 'Measles vaccine 1974-12-20' },
        }),
      ],
      asOf,
    )

    assert.equal(profile.immunisations[0]?.date, '1974-12-20')
    assert.equal(profile.immunisations[0]?.ageAtDoseMonths, 9)
  })

  it('leaves age at dose undefined when the record is too vague to say', () => {
    const vague = buildProfile(
      patient,
      [claim({ kind: 'immunisation', verbatim: 'Measles vaccine, as a child' })],
      asOf,
    ).immunisations[0]

    assert.equal(vague?.date, undefined)
    assert.equal(vague?.ageAtDoseMonths, undefined)

    // A bare year is a twelve-month window, so it cannot answer "before 12 months?".
    const yearOnly = buildProfile(
      patient,
      [claim({ kind: 'immunisation', verbatim: 'Measles 1975' })],
      asOf,
    ).immunisations[0]

    assert.equal(yearOnly?.date, '1975')
    assert.equal(yearOnly?.ageAtDoseMonths, undefined)
  })

  it('reads a dose number when the record states one', () => {
    const facts = buildProfile(
      patient,
      [
        claim({ id: 'a', kind: 'immunisation', verbatim: 'MMR dose 2, 1979-04-01' }),
        claim({ id: 'b', kind: 'immunisation', verbatim: 'Polio 3rd dose' }),
        claim({ id: 'c', kind: 'immunisation', verbatim: 'BCG' }),
      ],
      asOf,
    ).immunisations

    assert.deepEqual(
      facts.map((f) => f.doseNumber),
      [2, 3, undefined],
    )
  })

  it('marks a fact synthesised when its source document was', () => {
    const claims = [
      claim({ id: 'a', kind: 'immunisation', verbatim: 'Measles', source: { kind: 'document', id: 'card', quote: 'Measles' } }),
      claim({ id: 'b', kind: 'condition', verbatim: 'diabetes' }),
    ]

    const profile = buildProfile(patient, claims, asOf, ['card'])

    assert.equal(profile.immunisations[0]?.synthesised, true)
    assert.equal(profile.conditions[0]?.synthesised, false)
  })
})

describe('ageFact', () => {
  it('quotes the birthDate verbatim from the sim record', () => {
    // ADR 14: age read from the frozen snapshot is a claim like any other, and
    // the quote is the record's own line rather than a sentence about the age.
    assert.deepEqual(ageFact(buildProfile(patient, [], asOf)), {
      key: 'age',
      verbatim: '1974-03-15',
      confidence: 'document-evidenced',
      source: { kind: 'sim-record', id: 'p1', quote: '1974-03-15' },
      synthesised: false,
    })
  })
})
