import { describe, expect, it } from 'vitest'
import { buildSimAction } from './simAction'
import type { Recommendation } from '../../src/types'

/** A minimal recommendation, one field overridden per test. */
function recommendation(overrides: Partial<Recommendation> = {}): Pick<
  Recommendation,
  'kind' | 'title' | 'rationale' | 'target' | 'clinicianNote'
> {
  return {
    kind: 'referral',
    title: 'Refer to diabetic eye screening',
    rationale: 'Type 2 diabetes mellitus, no screening on record. See SIM-000001.',
    target: 'referrals',
    ...overrides,
  }
}

describe('buildSimAction', () => {
  it('maps a prescription to draft_prescription with the rationale as indication', () => {
    const action = buildSimAction(recommendation({ kind: 'prescription', title: 'Mebeverine 135mg tablets' }), 'SIM-000001')
    expect(action.type).toBe('draft_prescription')
    expect(action.patientId).toBe('SIM-000001')
    expect(action.medicationOrder?.drug).toBe('Mebeverine 135mg tablets')
    expect(action.medicationOrder?.indication).toBe(recommendation().rationale)
  })

  it('maps a referral to create_referral and carries the rationale in the title', () => {
    const action = buildSimAction(recommendation({ kind: 'referral' }), 'SIM-000001')
    expect(action.type).toBe('create_referral')
    expect(action.target).toBe('referrals')
    expect(action.title).toContain('Refer to diabetic eye screening')
    expect(action.title).toContain('Type 2 diabetes mellitus')
  })

  it('maps a test to order_test and resolves a known panel from the text', () => {
    const action = buildSimAction(
      recommendation({ kind: 'test', title: 'HbA1c check', rationale: 'Annual diabetes review due.' }),
      'SIM-000001',
    )
    expect(action.type).toBe('order_test')
    expect(action.bloodTestOrder?.panelId).toBe('hba1c')
    expect(action.bloodTestOrder?.clinicalDetails).toBe('Annual diabetes review due.')
  })

  it('leaves panelId unset for a test whose text matches no known panel', () => {
    const action = buildSimAction(recommendation({ kind: 'test', title: 'Chest X-ray' }), 'SIM-000001')
    expect(action.bloodTestOrder?.panelId).toBeUndefined()
  })

  it('maps screening and immunisation to create_task', () => {
    expect(buildSimAction(recommendation({ kind: 'screening' }), 'SIM-000001').type).toBe('create_task')
    expect(buildSimAction(recommendation({ kind: 'immunisation' }), 'SIM-000001').type).toBe('create_task')
  })

  it('carries the rationale in the title for create_task, since the sim drops text', () => {
    const action = buildSimAction(recommendation({ kind: 'screening' }), 'SIM-000001')
    expect(action.type).toBe('create_task')
    expect(action.title).toContain(recommendation().rationale)
  })

  /**
   * The note is the one part of the payload a person wrote, so every field the
   * sim shows a prescriber has to carry it and has to say whose words they are.
   */
  it('appends the clinician note to indication, labelled', () => {
    const action = buildSimAction(
      recommendation({ kind: 'prescription', clinicianNote: '  Halve the dose while renal function is unknown.  ' }),
      'SIM-000001',
    )
    expect(action.medicationOrder?.indication).toBe(
      `${recommendation().rationale} Clinician note: Halve the dose while renal function is unknown.`,
    )
  })

  it('appends the clinician note to clinicalDetails', () => {
    const action = buildSimAction(
      recommendation({ kind: 'test', title: 'HbA1c check', rationale: 'Annual review due.', clinicianNote: 'Fasting.' }),
      'SIM-000001',
    )
    expect(action.bloodTestOrder?.clinicalDetails).toBe('Annual review due. Clinician note: Fasting.')
  })

  /** The action types the sim drops `text` on would otherwise lose the note entirely. */
  it('carries the clinician note in the title for the types that drop text', () => {
    const action = buildSimAction(recommendation({ kind: 'referral', clinicianNote: 'Urgent.' }), 'SIM-000001')
    expect(action.title).toContain('Clinician note: Urgent.')
  })

  /** A note nobody wrote must not leave the label behind on its own. */
  it('leaves the evidence text alone when there is no note, or only whitespace', () => {
    expect(buildSimAction(recommendation({ kind: 'prescription' }), 'SIM-000001').medicationOrder?.indication).toBe(
      recommendation().rationale,
    )
    expect(
      buildSimAction(recommendation({ kind: 'prescription', clinicianNote: '   ' }), 'SIM-000001').medicationOrder
        ?.indication,
    ).toBe(recommendation().rationale)
  })

  it('truncates a title over 500 characters', () => {
    const action = buildSimAction(
      recommendation({ kind: 'referral', rationale: 'x'.repeat(600) }),
      'SIM-000001',
    )
    expect(action.title.length).toBeLessThanOrEqual(500)
  })
})
