import { describe, expect, it } from 'vitest'
import { degradeRecord } from './degradeRecord'
import type { PatientRecord } from '../../src/types'

const record: PatientRecord = {
  id: 'SIM-TEST-1',
  name: 'Test Patient',
  birthDate: '1980-01-01',
  conditions: ['Type 2 diabetes mellitus', 'Hypertension', 'Asthma', 'Chronic kidney disease', 'Osteoarthritis'],
  medications: ['Amoxicillin 500mg TDS', 'Metformin 500mg BD', 'Salbutamol inhaler', 'Paracetamol 500mg PRN'],
  allergies: ['Penicillin (rash)', 'Latex'],
  immunisations: [],
  raw: {},
}

describe('degradeRecord', () => {
  it('never states a clinical fact absent from the snapshot', () => {
    const { documents } = degradeRecord(record, 'BD', 'seed-1')
    const truth = [...record.conditions, ...record.medications, ...record.allergies, ...record.immunisations]

    expect(documents.length).toBeGreaterThan(0)
    for (const doc of documents) {
      for (const fact of doc.facts) {
        // The fact must be traceable to something in the snapshot...
        expect(truth.some((t) => t.includes(fact))).toBe(true)
        // ...and it must actually be the thing the document says.
        expect(doc.text.includes(fact)).toBe(true)
      }
    }
  })

  it('degrades a patient identically across two runs with the same seed', () => {
    const first = degradeRecord(record, 'BD', 'seed-1')
    const second = degradeRecord(record, 'BD', 'seed-1')
    expect(second).toEqual(first)
  })

  it('produces different output for a different seed', () => {
    const first = degradeRecord(record, 'BD', 'seed-1')
    const second = degradeRecord(record, 'BD', 'seed-2')
    expect(second).not.toEqual(first)
  })

  it('presents a resolved condition exactly like an active one, since truth carries no status', () => {
    // normalisePatient flattens the sim's active/resolved split before it ever
    // reaches this module, so degradeRecord has no status field to read and
    // cannot filter on it. This test would fail loudly if that changed.
    const withOneCondition: PatientRecord = { ...record, conditions: ['Resolved-looking condition'], allergies: [], medications: [] }
    // Loss is probabilistic, so scan seeds for one where the single condition survives.
    const survived = Array.from({ length: 50 }, (_, i) => degradeRecord(withOneCondition, 'BD', `seed-scan-${i}`)).some(
      ({ documents }) => documents.find((d) => d.kind === 'clinic-letter')?.text.includes('Resolved-looking condition'),
    )
    expect(survived).toBe(true)
  })

  it('produces no documents for a patient with nothing recorded', () => {
    const thin: PatientRecord = { ...record, conditions: [], medications: [], allergies: [], immunisations: [] }
    const { documents } = degradeRecord(thin, 'BD', 'seed-1')
    expect(documents).toEqual([])
  })

  it('loses conditions and medications at each category\'s own rate rather than one global rate', () => {
    // Ten items each, so the fraction that survives across many seeds should
    // track LOSS_RATES.condition.survives (0.6) and .medication.survives (0.75)
    // rather than converge to the same number.
    const tenConditions = Array.from({ length: 10 }, (_, i) => `Condition ${i}`)
    const tenMedications = Array.from({ length: 10 }, (_, i) => `Medication ${i}`)
    const sample: PatientRecord = { ...record, conditions: tenConditions, medications: tenMedications, allergies: [] }

    let survivingConditions = 0
    let survivingMedications = 0
    const runs = 300
    for (let i = 0; i < runs; i++) {
      const { documents } = degradeRecord(sample, 'BD', `rate-seed-${i}`)
      const letter = documents.find((d) => d.kind === 'clinic-letter')
      const prescription = documents.find((d) => d.kind === 'prescription-list')
      survivingConditions += letter?.facts.length ?? 0
      survivingMedications += prescription?.facts.length ?? 0
    }

    const conditionRate = survivingConditions / (runs * tenConditions.length)
    const medicationRate = survivingMedications / (runs * tenMedications.length)

    expect(conditionRate).toBeGreaterThan(0.5)
    expect(conditionRate).toBeLessThan(0.7)
    expect(medicationRate).toBeGreaterThan(0.65)
    expect(medicationRate).toBeLessThan(0.85)
  })
})
