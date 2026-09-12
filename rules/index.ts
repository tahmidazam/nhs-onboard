import { rule as nhsAskAllergies } from './nhs-ask-allergies'
import { rule as nhsEstablishSex } from './nhs-establish-sex'
import { rule as ukhsaImmPrimaryCourse } from './ukhsa-imm-primary-course'
import { rule as ukhsaImmMmrUnder12Months } from './ukhsa-imm-mmr-under-12-months'
import { rule as nhsScreenBowel } from './nhs-screen-bowel'
import { rule as nhsScreenDiabeticEye } from './nhs-screen-diabetic-eye'
import { rule as ukhsaCountryHepb } from './ukhsa-country-hepb'
import { rule as nhsContinueMedication } from './nhs-continue-medication'
import { rule as nhsRecordCondition } from './nhs-record-condition'
import { rule as nhsRecordAllergy } from './nhs-record-allergy'
import { rule as nhsGeneralHistory } from './nhs-general-history'
import type { RulePack } from './types'

/**
 * The pack.
 *
 * Evaluation is still order-independent: rules/engine.ts runs every rule that
 * the country gate admits, no rule suppresses another, and duplicates collapse
 * on `outputKey` alone. Two rules firing on one patient means their conditions
 * are too broad, and the fix is narrowing one rather than a precedence graph.
 *
 * Gap selection is not order-independent. ADR 16 makes the adjudicator a sort
 * and a slice: gaps sort by the `priority` each rule declares, tie-break on
 * pack order, and the first five fill the call. So this array is also the queue
 * order within a priority tier, and moving a rule inside its tier changes which
 * questions a call asks once more than five gaps are open. Read the order below
 * as the order the call fills, and keep each rule beside the tier it declares.
 *
 * See docs/adr/0013-rules-are-typed-typescript-modules.md and
 * docs/adr/0016-extraction-is-the-only-model-stage.md.
 */
export const pack: RulePack = [
  // Priority 1. Allergy first: it is the one piece of history that changes what
  // a prescriber may safely do next. Sex next, because it gates which screening
  // the call goes on to offer at all.
  nhsAskAllergies,
  nhsEstablishSex,
  ukhsaImmPrimaryCourse,

  // Priority 2.
  ukhsaImmMmrUnder12Months,

  // No gap, so no priority and no place in the queue.
  nhsScreenBowel,
  nhsScreenDiabeticEye,
  ukhsaCountryHepb,
  nhsContinueMedication,
  nhsRecordCondition,
  nhsRecordAllergy,

  // Priority 3, last in the tier and last in the pack: four sections a
  // clinician would like filled, behind everything a prescription rests on.
  nhsGeneralHistory,
]
