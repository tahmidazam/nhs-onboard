/**
 * Six simulator patients seeded ahead of demo day, so the clinician screen
 * opens onto a populated list rather than an empty one.
 *
 * This is a convenience, not a curated shortlist. ADR 12 holds: selection is
 * arbitrary and visible, and the patient finder still searches and rolls across
 * all 50,000 patients, so a judge who wants their own patient gets one on the
 * same path an operator uses. What is committed here is a starting position for
 * a screen that would otherwise be blank for the first two minutes of a demo.
 * Nothing filters these six by record contents in the sense ADR 12 forbids: the
 * spread below is deliberately unflattering, and includes a patient with an
 * empty record so the thin case is on screen rather than avoided.
 *
 * ## The ids are real, and stable across worlds
 *
 * Every id, name, birth date and record count below was read from the live sim
 * on 12 September 2026 through `sim.search` and `sim.preview`, not invented.
 *
 * The nhs-sim skill says each team key gets an isolated world, which raises the
 * question of whether a committed id survives a change of key. Tested: posting
 * `/api/keys` under a fresh team name created a new world (`created: true`), and
 * searching that world for `SIM-000015` returned `SIM-000015 / Grace Shah /
 * 1959-01-23`, the same identity our world holds. A world isolates the writes
 * made into it, not the 50,000-patient population it starts from, so these ids
 * resolve under any key.
 *
 * Record counts are a different matter. They are what our world held when
 * sampled, and a `save_problem` or `save_allergy` written into a world adds to
 * them. `demo.seedCohort` therefore re-reads identity from the sim rather than
 * trusting the names below, and reports a patient it cannot find rather than
 * onboarding a row from stale constants.
 *
 * ## Why these six
 *
 * The spread is over what the pipeline has to survive, not over how good the
 * result looks: severity from near-pristine to severe, both brand datasets,
 * translated and untranslated, and one record with nothing in it at all.
 * `severity` is the operator's dial from convex/lib/degradeConstants.ts, where
 * `DEFAULT_SEVERITY` is 0.5 and `scaleLoss` raises every survival rate to the
 * power `2 * severity`, so 0.1 loses almost nothing and 0.95 loses most of a
 * record.
 *
 * Each entry records what the seeded run of 12 September 2026 actually produced
 * for that patient: facts recovered out of the frozen total (ADR 11), and
 * actions proposed. They are one run's numbers and the next run's will differ,
 * because extraction is a model. Worth reading together rather than one at a
 * time: recovery does not fall as severity rises across this cohort. Matilda
 * Howard at 0.4 recovered 5 of 6 and Grace Shah at 0.5 recovered 3 of 10, so on
 * these six the length of the record and what translation did to it matter more
 * than the dial does.
 */

export interface DemoCohortEntry {
  /** Simulator patient id. Identity is re-read from the sim at seed time. */
  simId: string
  /** ISO 3166-1 alpha-2, and one of `BRAND_SOURCES` in src/lib/sources.ts. */
  country: string
  /** 0 is a pristine record, 1 the heaviest loss. See convex/lib/degradeConstants.ts. */
  severity: number
  /** False presents the record in English, which is the control case. */
  translate: boolean
}

/**
 * Only BD and IN appear, because only BD and IN have a brand dataset:
 * `BRAND_SOURCES` in src/lib/sources.ts holds those two, `selectableCountries()`
 * offers those two, and `patients.onboard` rejects anything else outright. The
 * IDD fallback covers 44 markets with no country column, which is why it is a
 * fallback and not a third entry here.
 */
export const DEMO_COHORT: DemoCohortEntry[] = [
  /**
   * Thomas Chen, 1975-04-12. 6 conditions, 2 medications, 0 allergies:
   * Beclometasone inhaler and Salbutamol inhaler.
   *
   * The clean map, and the control the other five are read against. Severity
   * 0.1 keeps nearly every fact, and English keeps every brand string in Latin
   * script, so both medications make it through the round trip intact: the
   * degrader renders them as the MEDEX brands Ascon-F and Asul, and
   * `brands.resolve` takes both back to Beclometasone and Salbutamol via
   * `bd-medex` with `unresolved: false`. If this patient's medications arrive
   * unmapped, the fault is ours and not the record's.
   *
   * Seeded: 7 of 8 facts recovered, 6 actions proposed.
   */
  { simId: 'SIM-000009', country: 'BD', severity: 0.1, translate: false },

  /**
   * Matilda Y. Howard, 1975-11-22. 4 conditions, 1 medication, 1 allergy:
   * Metformin tablets, allergic to Amoxicillin.
   *
   * The unresolved brand. BD renders Metformin as the MEDEX brand DMF, and
   * translation then writes that brand in Bengali script, which no dataset
   * carries: CONTEXT.md records that gap, and the transliteration pass ahead of
   * the lookup is what this patient exercises. Where it fails the claim lands
   * in `uncertain-mapping` and is shown verbatim rather than actioned, which is
   * ADR 3 doing its job on screen.
   *
   * Also the only drug allergy in the sample. Amoxicillin is an allergy that
   * changes a prescribing decision, unlike the Latex that most sim allergy rows
   * hold, so it is worth the slot.
   */
  { simId: 'SIM-001209', country: 'BD', severity: 0.4, translate: true },

  /**
   * Grace Shah, 1959-01-23. 8 conditions, 2 medications, 0 allergies:
   * Beclometasone inhaler and Salbutamol inhaler, over asthma, diabetes, CKD
   * and arthritis.
   *
   * The heavy translation, and the largest record in the cohort. Severity is
   * `DEFAULT_SEVERITY` exactly, so this is the midpoint a judge is shown rather
   * than an end stop, and the whole of a long record goes through Hindi.
   *
   * It is also the honest mapping case. Running the Indian dataset backwards
   * from an inhaler returns Asthalin Syrup and Bnc Cream, both the wrong dose
   * form and the second a combination cream, because 253,973 rows keyed on
   * composition hold no notion of which form a generic was prescribed in. The
   * forward lookup still recovers Salbutamol and Beclometasone as the
   * ingredient, so the demo shows a mapping that is right about the drug and
   * wrong about the form, which is what this data can honestly do.
   */
  { simId: 'SIM-000015', country: 'IN', severity: 0.5, translate: true },

  /**
   * Jude I. James, 1931-03-03. 5 conditions, 2 medications, 0 allergies:
   * Metformin tablets and Diclofenac gel, at 95.
   *
   * The Indian dataset without translation, which separates two failures that
   * look the same on screen. An unmapped brand here is the dataset's doing,
   * because the string reached the lookup in Latin script exactly as the
   * degrader wrote it; an unmapped brand on Grace Shah could be either the
   * dataset or the translation. Renders as Ali M 500mg Tablet and AT SP Tablet,
   * both of which resolve.
   *
   * Severity 0.65 is past the midpoint: names survive, doses and frequencies
   * mostly do not, so the medication rules run on a drug with no dose, which is
   * the ordinary case for a record carried by hand across a border.
   */
  { simId: 'SIM-001206', country: 'IN', severity: 0.65, translate: false },

  /**
   * Mohammed Clarke, 1930-07-24. 7 conditions, 2 medications, 0 allergies.
   *
   * Severe loss on a long record, at 96. At 0.85 most of seven conditions never
   * reach a document and the survivors arrive in Bengali as symptoms rather
   * than coded diagnoses. The point is the contrast with `patients.truth`: the
   * answer key is frozen at onboarding (ADR 11), so the recovery figure on this
   * patient is measured against everything the sim holds, including what the
   * degrader deliberately threw away.
   */
  { simId: 'SIM-000017', country: 'BD', severity: 0.85, translate: true },

  /**
   * Aisha Patel, 1992-05-12. 0 conditions, 0 medications, 0 allergies. The sim
   * holds an empty problem list for her.
   *
   * The thin record the call has to carry, and the case ADR 12 says a random
   * roll can land on: "nothing to extract means everything becomes a gap, and
   * gaps are what the voice call exists to close." Severity is 0.95 and has
   * nothing to act on, which is the point. Her documents are the synthesised
   * vaccination card (ADR 8) and little else, so every recommendation on this
   * patient rests on `patient-reported` evidence from the call, and the
   * clinician screen shows what that looks like next to five patients where it
   * does not.
   *
   * Committed deliberately. A cohort of six good records would be the curated
   * shortlist ADR 12 refuses to build.
   */
  { simId: 'SIM-000003', country: 'IN', severity: 0.95, translate: true },
]

export const DEMO_COHORT_SIM_IDS: string[] = DEMO_COHORT.map((entry) => entry.simId)
