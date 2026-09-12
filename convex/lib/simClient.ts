/**
 * HTTP client for the NHS neighbourhood simulator.
 * Used only from Convex actions. SIM_KEY never leaves the server.
 */

export interface SimPatientSummary {
  id: string
  name: string
  birthDate: string
  localIds: Record<string, string>
  conditions: string[]
  needs: string[]
  goals: string[]
}

export interface SimResource {
  id: string
  patientId?: string
  kind: string
  title: string
  status: string
  data: Record<string, unknown>
}

export interface SimView {
  resources: SimResource[]
  resourceTotal: number
  resourceOffset: number
  resourceLimit: number
}

export interface SimClock {
  now: number
  paused: boolean
  speed: number
}

const MAX_RETRIES = 8
const RETRY_PAUSE_MS = 3000

function env(name: 'SIM_KEY' | 'SIM_ORIGIN'): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set on this Convex deployment`)
  return value
}

export class SimError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'SimError'
  }
}

/** Parses the sim's two error shapes into one readable message. */
function parseErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error !== 'string') return body
    try {
      const issues = JSON.parse(parsed.error) as { path?: unknown; message?: unknown }[]
      return issues.map((i) => `${String(i.path ?? '')}: ${String(i.message ?? '')}`).join('; ')
    } catch {
      return parsed.error
    }
  } catch {
    return body
  }
}

/**
 * Fetches from the sim, retrying an empty or bodyless 502 with a pause.
 * Sustained bursts return bodyless 502s for around 30 seconds with no
 * rate-limit headers, so a bodyless response is treated as transient.
 */
async function simFetch(path: string, init?: RequestInit): Promise<unknown> {
  const origin = env('SIM_ORIGIN')
  const key = env('SIM_KEY')

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${key}` },
    })
    const text = await response.text()

    if (response.status === 502 && text.trim() === '') {
      if (attempt >= MAX_RETRIES) {
        throw new SimError('Simulator kept returning empty 502 responses', 502)
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_PAUSE_MS))
      continue
    }

    if (!response.ok) throw new SimError(parseErrorBody(text), response.status)

    return text ? JSON.parse(text) : null
  }
}

export async function searchPatients(
  q: string | undefined,
  offset: number,
): Promise<{ items: SimPatientSummary[]; total: number }> {
  const params = new URLSearchParams({ offset: String(offset) })
  if (q) params.set('q', q)
  return (await simFetch(`/api/sites/gp/patients?${params}`)) as {
    items: SimPatientSummary[]
    total: number
  }
}

/** Fetches every resource page for one patient, merging them into one list. */
export async function viewPatient(patientId: string): Promise<SimResource[]> {
  const resources: SimResource[] = []
  let offset = 0
  for (;;) {
    const params = new URLSearchParams({ patient: patientId, offset: String(offset), limit: '500' })
    const page = (await simFetch(`/api/sites/gp/view?${params}`)) as SimView
    resources.push(...page.resources)
    offset += page.resourceLimit
    if (offset >= page.resourceTotal) break
  }
  return resources
}

export async function readClock(): Promise<SimClock> {
  return (await simFetch('/api/clock')) as SimClock
}
