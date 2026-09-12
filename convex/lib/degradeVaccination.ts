/**
 * Synthesises a vaccination card, since the simulator carries no
 * immunisation data. Pure: takes data, returns data. No fetching, no
 * database access, no model call. See docs/adr/0008-synthesised-immunisations-for-demo.md.
 *
 * Every entry here is invented, never read from `patients.truth`, and the
 * output always carries `synthesised: true` so the caller can label it and
 * keep it out of the recovery denominator.
 */
import { LOSS_RATES } from './degradeConstants'

export interface SynthesisedDocument {
  kind: 'vaccination-card'
  language: string
  country: string
  text: string
  synthesised: true
}

const CLINIC_NAMES = [
  'Green Valley Medical Centre',
  'Riverside Family Clinic',
  'St Augustine General Hospital',
  'Sunrise Community Health Centre',
  'Lakeside Polyclinic',
  'Union Diagnostic and Medical Centre',
]

/** Deterministic PRNG seeded from a string. Mirrors degradeRecord.ts's generator. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function random() {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]
}

function referenceNumber(rng: () => number): string {
  return `IMM-${Math.floor(rng() * 900000 + 100000)}`
}

/**
 * A typical childhood schedule, close to the WHO Expanded Programme on
 * Immunization most national programmes follow. `minAgeYears` is the age by
 * which a patient would plausibly have received it.
 */
const SCHEDULE = [
  { vaccine: 'BCG (tuberculosis)', minAgeYears: 0, phrase: 'given at birth' },
  { vaccine: 'Hepatitis B (birth dose)', minAgeYears: 0, phrase: 'given at birth' },
  { vaccine: 'Polio (OPV)', minAgeYears: 0.5, phrase: 'given as an infant' },
  { vaccine: 'Pentavalent (DTP-HepB-Hib)', minAgeYears: 0.5, phrase: 'given as an infant' },
  { vaccine: 'Measles / MMR', minAgeYears: 1, phrase: 'given as a toddler' },
  { vaccine: 'DPT booster', minAgeYears: 5, phrase: 'given in primary school' },
  { vaccine: 'Tetanus-diphtheria booster', minAgeYears: 12, phrase: 'given in adolescence' },
] as const

function ageInYears(birthDate: string, now: number): number {
  const birth = new Date(birthDate).getTime()
  if (Number.isNaN(birth)) return 0
  return Math.max(0, (now - birth) / (365.25 * 24 * 60 * 60 * 1000))
}

/** Adds whole years to an ISO date, for the rare case an exact date survives. */
function addYears(birthDate: string, years: number): string {
  const date = new Date(birthDate)
  if (Number.isNaN(date.getTime())) return birthDate
  date.setUTCFullYear(date.getUTCFullYear() + Math.round(years))
  return date.toISOString().slice(0, 10)
}

/**
 * Synthesises a vaccination card plausible for a patient's age and country.
 * Seeded, so the same `seed` always produces the same card. Only vaccines
 * the patient's current age would plausibly cover are candidates.
 */
export function synthesiseVaccinationCard(
  name: string,
  birthDate: string,
  country: string,
  seed: string,
  now: number,
): SynthesisedDocument {
  const rng = seededRandom(seed)
  const age = ageInYears(birthDate, now)

  const lines: string[] = []
  for (const entry of SCHEDULE) {
    if (age < entry.minAgeYears) continue
    if (rng() > LOSS_RATES.immunisation.survives) continue

    const keepExactDate = rng() < LOSS_RATES.immunisation.attributes.exactDate
    const when = keepExactDate ? `given on ${addYears(birthDate, entry.minAgeYears)}` : entry.phrase
    lines.push(`- ${entry.vaccine}: ${when}`)
  }

  const text = [
    pick(rng, CLINIC_NAMES),
    `Reference: ${referenceNumber(rng)}`,
    `Patient: ${name} (DOB ${birthDate})`,
    '',
    'This card is synthesised. The simulator carries no immunisation history, so this record',
    "estimates a schedule plausible for the patient's age rather than reporting one on file.",
    '',
    'Vaccinations:',
    ...(lines.length ? lines : ['No vaccination history could be estimated for this patient.']),
  ].join('\n')

  return { kind: 'vaccination-card', language: 'en', country, text, synthesised: true }
}
