import { v } from 'convex/values'
import { action } from './_generated/server'
import { searchPatients, viewPatient, readClock, type SimPatientSummary } from './lib/simClient'
import { normalisePatient } from './lib/normalisePatient'

const patientSummary = v.object({
  id: v.string(),
  name: v.string(),
  birthDate: v.string(),
  conditionCount: v.number(),
})

function toSummary(patient: SimPatientSummary) {
  return {
    id: patient.id,
    name: patient.name,
    birthDate: patient.birthDate,
    conditionCount: patient.conditions.length,
  }
}

/** Searches the simulator's patient directory, paged at 30 by the sim itself. */
export const search = action({
  args: { q: v.optional(v.string()), offset: v.number() },
  returns: v.object({ items: v.array(patientSummary), total: v.number() }),
  handler: async (_ctx, { q, offset }) => {
    const { items, total } = await searchPatients(q, offset)
    return { items: items.map(toSummary), total }
  },
})

/**
 * Picks one patient at random from the full population matching an optional
 * search, not from the first page. See ADR 12.
 */
export const random = action({
  args: { q: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({ patient: patientSummary, offset: v.number(), total: v.number() })),
  handler: async (_ctx, { q }) => {
    const { total } = await searchPatients(q, 0)
    if (total === 0) return null
    const offset = Math.floor(Math.random() * total)
    const { items } = await searchPatients(q, offset)
    const patient = items[0]
    if (!patient) return null
    return { patient: toSummary(patient), offset, total }
  },
})

/** Full record size for one candidate: conditions, medications, allergies. */
export const preview = action({
  args: { patientId: v.string(), name: v.string(), birthDate: v.string() },
  returns: v.object({
    conditions: v.array(v.string()),
    medications: v.array(v.string()),
    allergies: v.array(v.string()),
  }),
  handler: async (_ctx, { patientId, name, birthDate }) => {
    const resources = await viewPatient(patientId)
    const record = normalisePatient({
      patient: { id: patientId, name, birthDate, localIds: {}, conditions: [], needs: [], goals: [] },
      resources,
    })
    return { conditions: record.conditions, medications: record.medications, allergies: record.allergies }
  },
})

/** Simulation time, for rendering timestamps as simulation time rather than wall clock. */
export const clock = action({
  args: {},
  returns: v.object({ now: v.number(), paused: v.boolean(), speed: v.number() }),
  handler: async () => {
    const { now, paused, speed } = await readClock()
    return { now, paused, speed }
  },
})
