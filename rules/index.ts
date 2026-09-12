import { rule as ukhsaImmPrimaryCourse } from './ukhsa-imm-primary-course'
import { rule as ukhsaImmMmrUnder12Months } from './ukhsa-imm-mmr-under-12-months'
import { rule as nhsScreenBowel } from './nhs-screen-bowel'
import { rule as nhsScreenDiabeticEye } from './nhs-screen-diabetic-eye'
import { rule as ukhsaCountryHepb } from './ukhsa-country-hepb'
import { rule as ukhsaNewArrivalOrientation } from './ukhsa-new-arrival-orientation'
import { rule as nhsContinueMedication } from './nhs-continue-medication'
import { rule as nhsRecordCondition } from './nhs-record-condition'
import { rule as nhsRecordAllergy } from './nhs-record-allergy'
import type { RulePack } from './types'

/**
 * The pack. Order is for reading only: evaluation is order-independent and no
 * rule suppresses another. See docs/adr/0013-rules-are-typed-typescript-modules.md.
 */
export const pack: RulePack = [
  ukhsaImmPrimaryCourse,
  ukhsaImmMmrUnder12Months,
  nhsScreenBowel,
  nhsScreenDiabeticEye,
  ukhsaCountryHepb,
  ukhsaNewArrivalOrientation,
  nhsContinueMedication,
  nhsRecordCondition,
  nhsRecordAllergy,
]
