import { describe, expect, it } from 'vitest'
import { narrativeText, normalisePatient, sexFromNarrative } from './normalisePatient'
import type { NormaliseInput } from './normalisePatient'
import fixture from './__fixtures__/sim-view-SIM-000015.json'

/**
 * Captured from GET /api/sites/gp/patients?q=Grace+Shah and
 * GET /api/sites/gp/view?patient=SIM-000015, merged across every resource
 * page. See docs/agents for how this repo captures fixtures.
 */
const capturedResponse = fixture as unknown as NormaliseInput

describe('normalisePatient', () => {
  it('produces the expected PatientRecord from a captured simulator response', () => {
    const record = normalisePatient(capturedResponse)

    expect(record).toEqual({
      id: 'SIM-000015',
      name: 'Grace Shah',
      birthDate: '1959-01-23',
      conditions: [
        'Asthma',
        'Diabetes',
        'Arthritis',
        'Musculoskeletal symptoms',
        'Sleep concern',
        'Medication review',
        'Preventive health review',
        'Follow-up after hospital contact',
      ],
      medications: ['Beclometasone inhaler', 'Salbutamol inhaler'],
      allergies: [],
      immunisations: [],
      raw: capturedResponse.resources,
    })
  })

  it('deduplicates a medication repeated across separate issues', () => {
    const record = normalisePatient(capturedResponse)
    expect(record.medications.filter((m) => m === 'Salbutamol inhaler')).toHaveLength(1)
  })

  it('unions ehr-record problems with sibling problem resources, hiding the superseded row', () => {
    const ehrRecord = capturedResponse.resources.find((r) => r.kind === 'ehr-record')!
    // Index 7 ("Follow-up after hospital contact") appears only once in the
    // fixture's generated problems, so hiding it is unambiguous to assert on.
    const supersededIndex = 7

    const withUpdatedProblem: NormaliseInput = {
      ...capturedResponse,
      resources: [
        ...capturedResponse.resources,
        {
          id: 'r-updated-1',
          kind: 'problem',
          title: 'Problem updated',
          status: 'available',
          data: {
            term: 'Follow-up after hospital contact (reviewed)',
            sourceProblemKey: `${ehrRecord.id}:${supersededIndex}`,
          },
        },
      ],
    }

    const record = normalisePatient(withUpdatedProblem)

    expect(record.conditions).not.toContain('Follow-up after hospital contact')
    expect(record.conditions).toContain('Follow-up after hospital contact (reviewed)')
  })

  it('has no immunisations, because the simulator carries none (ADR 8)', () => {
    const record = normalisePatient(capturedResponse)
    expect(record.immunisations).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* Sex, read out of the sim's own prose. See ADR 20.                            */
/* -------------------------------------------------------------------------- */

const resources = capturedResponse.resources

/** Adds one resource to the captured view, leaving everything else as captured. */
const withResource = (kind: string, data: Record<string, unknown>) => [
  ...resources,
  { id: 'r-added-1', kind, title: 'Added for this test', status: 'available', data },
]

describe('narrativeText', () => {
  it('reads the two kinds the sim writes patient prose in', () => {
    // Both of SIM-000015's encounters say the same thing, which is the sim's
    // own repetition rather than a bug here.
    expect(narrativeText(resources)).toBe(
      [
        'Fictional consultation. The patient discussed their next appointment and contact preferences.',
        'Fictional consultation. The patient discussed their next appointment and contact preferences.',
      ].join('\n'),
    )
  })

  it('reads observation.text as well as encounter.text', () => {
    const text = narrativeText(withResource('observation', { text: 'She prefers telephone contact.' }))
    expect(text.endsWith('She prefers telephone contact.')).toBe(true)
  })

  it('ignores a message template, which addresses the patient in the second person', () => {
    expect(narrativeText(resources)).not.toContain('Your appointment booking')
  })

  it('ignores discharge summary prose, which narrates staff rather than the patient', () => {
    expect(narrativeText(resources)).not.toContain('discharge coordinator')
  })
})

describe('sexFromNarrative', () => {
  it('finds nothing for SIM-000015, whose narrative carries no pronouns', () => {
    // The case CONTEXT.md records: 16 female pronouns on SIM-000001, 14 male on
    // SIM-000002, none at all on this patient. Sex is then a Gap for the call.
    expect(sexFromNarrative(resources)).toBeUndefined()
  })

  it('reads a pronoun the sim wrote, and quotes the sentence it read', () => {
    const read = sexFromNarrative(
      withResource('encounter', { text: 'Fictional consultation. She attended alone and declined transport.' }),
    )
    expect(read).toEqual({ value: 'female', quote: 'She attended alone and declined transport.' })
  })

  it('quotes verbatim, so the stored quote can be checked against the record', () => {
    const sentence = 'He attended with a relative.'
    const added = withResource('encounter', { text: `Fictional consultation. ${sentence}` })
    const read = sexFromNarrative(added)

    expect(read?.value).toBe('male')
    expect(narrativeText(added).includes(read!.quote)).toBe(true)
  })

  it('finds nothing when two resources disagree', () => {
    const conflicting = [
      ...withResource('encounter', { text: 'She attended alone.' }),
      { id: 'r-added-2', kind: 'encounter', title: 'Added', status: 'available', data: { text: 'He attended alone.' } },
    ]
    expect(sexFromNarrative(conflicting)).toBeUndefined()
  })

  it('does not read a pronoun out of a discharge summary, which may be about a clinician', () => {
    const withStaffPronoun = withResource('discharge-summary', {
      sections: { course: 'The coordinator recorded the handover. He confirmed the transport booking.' },
    })
    expect(sexFromNarrative(withStaffPronoun)).toBeUndefined()
  })
})
