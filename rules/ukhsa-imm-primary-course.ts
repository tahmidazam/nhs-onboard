import type { ImmunisationFact, PatientProfile, Rule, RuleOutcome } from './types'

/**
 * Fires on every patient. UKHSA's governing principle fires on absence: with no
 * documented or reliable verbal history the patient is assumed unimmunised and a
 * full primary course is planned, the age band selecting the ladder.
 *
 * Because it can rest on no fact at all there is no bucket to inherit, so it
 * declares `confidenceFloor: 'patient-reported'`: "we believe you have had no
 * vaccines" is a conversation, not a draft. See
 * docs/adr/0014-rule-output-inherits-the-weakest-evidence.md.
 *
 * It emits the plan and the question together, because planning the course and
 * asking whether a vaccination card exists at home are not alternatives.
 *
 * Source: UKHSA, vaccination of individuals with uncertain or incomplete
 * immunisation status, updated 5 June 2026, gateway 2026160, OGL v3.0.
 */

const SOURCE =
  'https://www.gov.uk/government/publications/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation-status-from-1-july-2025'

/**
 * The primary course is counted on the diphtheria, tetanus, pertussis and polio
 * ladder, which is the antigen every band's three visits share. Monovalent
 * hepatitis B is deliberately absent: a birth dose of hep B is not a dose of the
 * primary course, and counting it would resume a course that never started.
 */
const PRIMARY_COURSE =
  /\b(dtap|dtp|dpt|tdap|td|dt|ipv|opv|hib|hexavalent|pentavalent|penta|hexa|diphtheria|tetanus|pertussis|polio|whooping cough)\b/

/** "Leave a 4-week gap between visits." Three visits in every band. */
const VISITS = 3
const INTERVAL = '4-week'

/** "Infants from 8 weeks of age up to first birthday": the ladder's floor. */
const LADDER_STARTS_MONTHS = 2

interface AgeBand {
  /** The source's own heading, so the recommendation names the line it came from. */
  label: string
  /** One entry per visit, in the source's order. */
  visits: [string, string, string]
}

/**
 * The four bands, transcribed visit by visit from the algorithm. Footnote-only
 * qualifiers (subsequent vaccination, boosters, the PCV10 and OPV
 * discounts) are out of scope for this rule; see #15.
 */
const BANDS: AgeBand[] = [
  {
    label: 'Infants from 8 weeks of age up to first birthday',
    visits: [
      'DTaP/IPV/Hib/HepB, MenB, rotavirus',
      'DTaP/IPV/Hib/HepB, MenB, rotavirus',
      'DTaP/IPV/Hib/HepB, PCV13',
    ],
  },
  {
    label: 'Children from first up to second birthday',
    visits: [
      'DTaP/IPV/Hib/HepB, PCV13, MenB, MMRV',
      'DTaP/IPV/Hib/HepB, MenB',
      'DTaP/IPV/Hib/HepB',
    ],
  },
  {
    label: 'Children from second up to 10th birthday',
    visits: [
      'DTaP/IPV/Hib/HepB, MMR or MMRV',
      'DTaP/IPV/Hib/HepB, MMR or MMRV',
      'DTaP/IPV/Hib/HepB',
    ],
  },
  {
    label: 'From 10th birthday onwards',
    visits: ['Td/IPV, MenACWY, MMR', 'Td/IPV, MMR', 'Td/IPV'],
  },
]

function bandFor(profile: PatientProfile): AgeBand {
  if (profile.ageMonths < 12) return BANDS[0]
  if (profile.ageMonths < 24) return BANDS[1]
  if (profile.ageYears < 10) return BANDS[2]
  return BANDS[3]
}

function isPrimaryCourse(fact: ImmunisationFact): boolean {
  return PRIMARY_COURSE.test(`${fact.key} ${fact.verbatim} ${fact.resolved ?? ''}`.toLowerCase())
}

/**
 * A card recording "DTP, 2nd dose" evidences two doses from one row, so the
 * count is the higher of the rows read and the highest dose number on them.
 */
function dosesGiven(facts: ImmunisationFact[]): number {
  const numbered = facts.map((fact) => fact.doseNumber ?? 0)
  return Math.max(facts.length, ...numbered, 0)
}

export const rule: Rule = {
  id: 'ukhsa-imm-primary-course',
  kind: 'immunisation',
  target: 'gp',
  priority: 1,
  countries: 'all',
  confidenceFloor: 'patient-reported',
  reads: 'Recorded immunisations, or their absence, and age.',
  citations: [
    {
      url: 'https://www.gov.uk/government/publications/vaccination-of-individuals-with-uncertain-or-incomplete-immunisation-status',
      quote:
        'unless there is a documented or reliable verbal vaccine history, individuals should be assumed to be unimmunised and a full course of immunisations planned',
    },
    {
      url: `${SOURCE}#general-principles`,
      quote:
        'If the primary course has been started but not completed, resume the course – no need to repeat doses or restart course.',
    },
    {
      url: `${SOURCE}#general-principles`,
      quote:
        'Plan catch-up immunisation schedule with minimum number of visits and within a minimum possible timescale – aim to protect the individual in the shortest time possible.',
    },
    { url: `${SOURCE}#infants-from-8-weeks-of-age-up-to-first-birthday`, quote: 'Leave a 4-week gap between visits.' },
  ],
  evaluate(profile: PatientProfile): RuleOutcome[] {
    const started = profile.immunisations.filter(isPrimaryCourse)
    const given = dosesGiven(started)
    const remaining = VISITS - given

    const outcomes: RuleOutcome[] = []

    if (remaining > 0) {
      const band = bandFor(profile)
      const plan = band.visits
        .map((vaccines, index) => `visit ${index + 1}: ${vaccines}`)
        .slice(given)
        .join('; ')
      const doseText = remaining === 1 ? '1 dose' : `${remaining} doses`
      // The ladder's floor, so a newborn's plan does not read as due today.
      const start =
        profile.ageMonths < LADDER_STARTS_MONTHS ? ', starting from 8 weeks of age' : ''

      outcomes.push({
        kind: 'recommendation',
        outputKey: `${rule.id}:plan`,
        // `text` is dropped on create_task, so the evidence travels in the title.
        title: given
          ? `Resume primary immunisation course: ${doseText} at ${INTERVAL} intervals${start}. ${band.label} — ${plan}. ${given} dose${given === 1 ? '' : 's'} already recorded; UKHSA: "resume the course – no need to repeat doses or restart course."`
          : `Plan primary immunisation course: ${doseText} at ${INTERVAL} intervals${start}. ${band.label} — ${plan}. No vaccine history on record; UKHSA: "individuals should be assumed to be unimmunised and a full course of immunisations planned."`,
        rationale: given
          ? `${given} of ${VISITS} primary course doses are recorded, so the course resumes rather than restarts: ${doseText} remaining at ${INTERVAL} intervals, as ${band.label.toLowerCase()}.`
          : `No documented or reliable verbal vaccine history, so the patient is assumed unimmunised and a full course is planned: ${doseText} at ${INTERVAL} intervals, as ${band.label.toLowerCase()}. Resting on absence, this is a plan to confirm with the patient, not a booking.`,
        consumed: started,
      })
    }

    // Asked of every patient, whatever the record holds: a synthesised or verbal
    // history is exactly the uncertainty the algorithm is written for.
    outcomes.push({
      kind: 'gap',
      outputKey: `${rule.id}:card`,
      question:
        'Do you have a vaccination card, child health record, or a letter from a clinic showing which vaccines you have had? If not, can you tell us which clinic or country gave them, and roughly when?',
      consumed: started,
    })

    return outcomes
  },
}
