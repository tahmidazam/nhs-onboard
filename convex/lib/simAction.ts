import type { Recommendation, RecommendationKind, SimTarget } from '../../src/types'

/**
 * Maps a Recommendation to the sim action that writes it back.
 *
 * The sim silently drops `text` on `create_referral`, `create_task` and
 * `save_problem`, so those carry the rationale in `title` instead.
 * `draft_prescription` and `order_test` keep their own evidence field:
 * `indication` and `clinicalDetails` are copied into the sim's `data.text`.
 * See `.claude/skills/nhs-sim/SKILL.md`.
 *
 * Every one of those fields carries the clinician's note where there is one,
 * so a note written on the review screen reaches the prescribing screen rather
 * than stopping at Convex.
 */

export type SimActionType =
  | 'draft_prescription'
  | 'create_referral'
  | 'order_test'
  | 'create_task'
  | 'save_problem'
  | 'save_allergy'

const ACTION_TYPE: Record<RecommendationKind, SimActionType> = {
  prescription: 'draft_prescription',
  referral: 'create_referral',
  test: 'order_test',
  screening: 'create_task',
  immunisation: 'create_task',
  task: 'create_task',
  problem: 'save_problem',
  allergy: 'save_allergy',
}

const TITLE_MAX = 500

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The rationale as the sim should show it, with the clinician's note appended
 * and named.
 *
 * Named rather than merged: the rationale is the rule pack's sentence and the
 * note is a person's, they land in one field, and a prescriber reading it has
 * to be able to tell which is which. The note goes last because it is the later
 * and more specific of the two.
 */
function evidenceText(rec: Pick<Recommendation, 'rationale' | 'clinicianNote'>): string {
  const note = rec.clinicianNote?.trim()
  return note === undefined || note === '' ? rec.rationale : `${rec.rationale} Clinician note: ${note}`
}

/**
 * Folds the evidence into the title for the action types that drop `text`.
 *
 * The note rides here too, under the same 500 character cap. A note that gets
 * clipped still reaches the sim; a note left in `text` on one of these types
 * reaches nothing at all.
 */
function titleCarryingEvidence(rec: Pick<Recommendation, 'title' | 'rationale' | 'clinicianNote'>): string {
  return truncate(`${rec.title} — ${evidenceText(rec)}`, TITLE_MAX)
}

type PanelId = 'fbc' | 'ue' | 'hba1c' | 'lft' | 'crp' | 'lipids'

/** The sim accepts six panel ids only. Anything else routes the order as a referral instead. */
const PANEL_KEYWORDS: Array<{ id: PanelId; panel: string; pattern: RegExp }> = [
  { id: 'hba1c', panel: 'HbA1c', pattern: /hba1c/i },
  { id: 'fbc', panel: 'Full blood count', pattern: /full blood count|\bfbc\b/i },
  { id: 'ue', panel: 'Urea and electrolytes', pattern: /urea.*electrolytes|\bu ?&? ?e\b|renal function/i },
  { id: 'lft', panel: 'Liver function tests', pattern: /liver function|\blft\b/i },
  { id: 'crp', panel: 'C-reactive protein', pattern: /c-reactive protein|\bcrp\b/i },
  { id: 'lipids', panel: 'Lipid profile', pattern: /lipid|cholesterol/i },
]

function panelFor(text: string): { panelId: PanelId; panel: string } | undefined {
  const match = PANEL_KEYWORDS.find((candidate) => candidate.pattern.test(text))
  return match ? { panelId: match.id, panel: match.panel } : undefined
}

export interface SimAction {
  type: SimActionType
  patientId: string
  title: string
  text?: string
  target?: SimTarget
  medicationOrder?: {
    drug: string
    dose: string
    unit: string
    route: string
    frequency: string
    duration: string
    quantity: number
    indication: string
  }
  bloodTestOrder?: {
    panelId?: PanelId
    panel: string
    specimen: string
    priority: 'routine' | 'urgent'
    collection: 'now' | 'next-round'
    clinicalDetails: string
  }
}

/**
 * Builds the sim payload for one recommendation. `simPatientId` is the sim's
 * own id, `patients.simId`, never the Convex document id.
 */
export function buildSimAction(
  rec: Pick<Recommendation, 'kind' | 'title' | 'rationale' | 'target' | 'clinicianNote'>,
  simPatientId: string,
): SimAction {
  const type = ACTION_TYPE[rec.kind]

  switch (type) {
    case 'draft_prescription':
      // No structured dose lives on Recommendation yet, so the four logistics
      // fields the sim requires are fixed. `drug` and `indication` carry every
      // fact the recommendation actually knows.
      return {
        type,
        patientId: simPatientId,
        title: truncate(rec.title, TITLE_MAX),
        medicationOrder: {
          drug: rec.title,
          dose: '1',
          unit: 'tablet',
          route: 'Oral',
          frequency: 'Once daily',
          duration: '28 days',
          quantity: 28,
          indication: evidenceText(rec),
        },
      }

    case 'order_test': {
      const panel = panelFor(`${rec.title} ${rec.rationale}`)
      return {
        type,
        patientId: simPatientId,
        title: truncate(rec.title, TITLE_MAX),
        bloodTestOrder: {
          ...(panel ?? { panel: rec.title }),
          specimen: 'Venous blood',
          priority: 'routine',
          collection: 'now',
          clinicalDetails: evidenceText(rec),
        },
      }
    }

    case 'create_referral':
      return {
        type,
        patientId: simPatientId,
        title: titleCarryingEvidence(rec),
        text: evidenceText(rec),
        target: rec.target,
      }

    case 'create_task':
      return {
        type,
        patientId: simPatientId,
        title: titleCarryingEvidence(rec),
        text: evidenceText(rec),
      }

    // Both land on the record as history, not as work to do. The sim drops
    // `text` on save_problem, so the evidence rides in the title there and the
    // two cases stay apart rather than sharing create_task's branch.
    case 'save_problem':
      return {
        type,
        patientId: simPatientId,
        title: titleCarryingEvidence(rec),
        text: evidenceText(rec),
      }

    case 'save_allergy':
      return {
        type,
        patientId: simPatientId,
        title: truncate(rec.title, TITLE_MAX),
        text: evidenceText(rec),
      }
  }
}
