import { describe, expect, it } from 'vitest'
import { degradeRecord } from './degradeRecord'
import { DEFAULT_SEVERITY, scaleLoss } from './degradeConstants'
import { sexFromText } from './sexFromText'
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

describe('degradeRecord under a scaled loss table', () => {
  const factCount = (severity: number, seed = 'seed-1') =>
    degradeRecord(record, 'BD', seed, scaleLoss(severity)).documents.flatMap((d) => d.facts).length

  it('keeps every fact when the dial is set to lose nothing', () => {
    const { documents } = degradeRecord(record, 'BD', 'seed-1', scaleLoss(0))
    const names = documents.flatMap((d) => d.facts)

    for (const condition of record.conditions) expect(names).toContain(condition)
    expect(names).toContain('Latex')
  })

  it('carries fewer facts at full severity than at none', () => {
    expect(factCount(1)).toBeLessThan(factCount(0))
  })

  it('stays deterministic for a given seed and severity', () => {
    expect(degradeRecord(record, 'BD', 'seed-1', scaleLoss(0.8))).toEqual(
      degradeRecord(record, 'BD', 'seed-1', scaleLoss(0.8)),
    )
  })

  it('degrades no harder than the default when asked for less', () => {
    expect(factCount(0.25)).toBeGreaterThanOrEqual(factCount(0.5))
  })

  it('matches the untuned call at the default severity', () => {
    expect(degradeRecord(record, 'BD', 'seed-1', scaleLoss(DEFAULT_SEVERITY))).toEqual(
      degradeRecord(record, 'BD', 'seed-1'),
    )
  })
})

/**
 * ADR 20: the sim states sex only in narrative prose, read at onboarding and
 * passed in here. The degrader draws nothing, so a letter never contradicts
 * the name printed above the history.
 */
describe('degradeRecord with a sex established at onboarding', () => {
  const letterFor = (sex?: 'male' | 'female', seed = 'seed-1', loss = undefined) =>
    degradeRecord(record, 'BD', seed, loss, sex).documents.find((d) => d.kind === 'clinic-letter')!

  it('renders a coded diagnosis in the third person', () => {
    // Severity 0 keeps every condition and codes every one of them, so this
    // asserts the coded template on all five rather than on whichever survived.
    const letter = degradeRecord(record, 'BD', 'seed-1', scaleLoss(0), 'female').documents.find(
      (d) => d.kind === 'clinic-letter',
    )!
    for (const condition of record.conditions) {
      expect(letter.text).toContain(`She has a known diagnosis of ${condition}.`)
    }
  })

  it('renders an uncoded condition in the third person', () => {
    const lines = Array.from({ length: 40 }, (_, i) => letterFor('male', `sex-seed-${i}`).text.split('\n')).flat()
    const uncoded = lines.filter((line) => line.includes('describes ongoing issues consistent with'))

    expect(uncoded.length).toBeGreaterThan(0)
    for (const line of uncoded) expect(line.startsWith('He describes ongoing issues')).toBe(true)
  })

  it('closes the letter with an administrative line that does not depend on what survived', () => {
    expect(letterFor('female').text).toContain(
      'Please contact the clinic if she requires a copy of her records.',
    )
    expect(letterFor('male').text).toContain(
      'Please contact the clinic if he requires a copy of his records.',
    )
  })

  it('reverts to the pronoun-free templates when the sim never said', () => {
    const letter = letterFor(undefined)
    expect(sexFromText(letter.text)).toBeUndefined()
    expect(letter.text).not.toContain('Please contact the clinic')
    expect(letter.text).toContain('Patient describes ongoing issues consistent with')
  })

  it('reads back the sex it was given, and only that sex', () => {
    expect(sexFromText(letterFor('female').text)?.value).toBe('female')
    expect(sexFromText(letterFor('male').text)?.value).toBe('male')
  })

  /**
   * The reproducibility ADR 10 asks for. `sex` is consumed outside the
   * generator, so the loss decisions, the clinic name and the reference number
   * all fall the same way with it and without it. If this fails, every
   * already-onboarded patient re-degrades into a different record.
   */
  it('consumes no draw, so it changes the wording and nothing else', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `no-shift-${i}`
      const plain = degradeRecord(record, 'BD', seed)
      const gendered = degradeRecord(record, 'BD', seed, undefined, 'female')

      expect(gendered.documents.map((d) => d.facts)).toEqual(plain.documents.map((d) => d.facts))
      expect(gendered.documents.find((d) => d.kind === 'prescription-list')).toEqual(
        plain.documents.find((d) => d.kind === 'prescription-list'),
      )
    }
  })

  it('stays deterministic for a given seed and sex', () => {
    expect(degradeRecord(record, 'BD', 'seed-1', undefined, 'male')).toEqual(
      degradeRecord(record, 'BD', 'seed-1', undefined, 'male'),
    )
  })
})
