const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Renders an ISO date as '12 Sep 2026'. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/** Renders a simulation Unix timestamp in milliseconds as '12 Sep 2026, 14:32'. */
export function formatSimTime(ms: number): string {
  const date = new Date(ms)
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${formatDate(date.toISOString())}, ${hours}:${minutes}`
}

const STAGE_LABELS: Record<string, string> = {
  'not-onboarded': 'Not onboarded',
  degrading: 'Awaiting documents',
  'documents-ready': 'Documents ready',
  extracting: 'Extracting',
  mapping: 'Mapping medications',
  'applying-rules': 'Applying rules',
  'awaiting-call': 'Awaiting call',
  'ready-for-review': 'Ready for review',
  actioned: 'Actioned',
}

export function formatStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage
}
