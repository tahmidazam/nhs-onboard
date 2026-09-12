import { describe, expect, it } from 'vitest'
import { normalisePatient } from './normalisePatient'
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
