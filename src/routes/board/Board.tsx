import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { OnboardedTable } from './OnboardedTable'
import { PatientFinderDialog } from './PatientFinderDialog'

/**
 * The operator board. Two ways onto it: the committed demo cohort, and the
 * patient finder.
 *
 * The finder is the primary action and stays that way. ADR 12 requires
 * selection to be arbitrary and visible, and the cohort does not replace that:
 * it is six patients seeded in advance so the clinician screen is not empty for
 * the first minutes of a demo, and the reasoning for each of the six is in
 * convex/lib/demoCohort.ts. A judge who wants their own patient rolls or
 * searches for one on the same path an operator uses.
 */
export function Board() {
  const [finderOpen, setFinderOpen] = useState(false)
  const seedCohort = useAction(api.demo.seedCohort)
  const [seeding, setSeeding] = useState(false)

  /**
   * Idempotent, so the button is always available rather than only on an empty
   * board: `patients.upsert` is keyed on `simId`, and a reseed after a failed
   * patient is the ordinary way to fix one.
   */
  async function handleSeedCohort() {
    setSeeding(true)
    try {
      const results = await seedCohort({})
      const pipelined = results.filter((result) => result.outcome === 'pipelined')
      const problems = results.filter((result) => result.outcome !== 'pipelined')

      if (problems.length === 0) {
        toast.add({
          type: 'success',
          title: `${String(pipelined.length)} demo patients are ready to review`,
          description: 'Documents, claims, recommendations and call questions are all on the board.',
        })
      } else {
        toast.add({
          type: 'error',
          title: `${String(pipelined.length)} of ${String(results.length)} demo patients are ready`,
          description: problems
            .map((result) => `${result.name ?? result.simId}: ${result.error ?? result.outcome}`)
            .join('. '),
        })
      }
    } catch (err) {
      toast.add({
        type: 'error',
        title: 'The demo patients could not be seeded',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Onboarded patients</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void handleSeedCohort()} disabled={seeding}>
            {seeding ? <Spinner /> : null}
            Seed six demo patients
          </Button>
          <Button onClick={() => setFinderOpen(true)}>
            <PlusIcon />
            Find a patient
          </Button>
        </div>
      </div>

      {/**
       * Several minutes, so the wait gets a sentence rather than only a
       * spinner. The board below stays live throughout: every patient's stage
       * is a reactive query, so the rows appear and advance while this runs.
       */}
      {seeding ? (
        <p className="text-sm text-muted-foreground">
          Onboarding six patients from the simulator, then degrading, extracting, mapping and
          applying the rule pack to each one in turn. Extraction runs four agents per document, so
          this takes several minutes. The stage column updates as each patient lands.
        </p>
      ) : null}

      <OnboardedTable />

      <PatientFinderDialog open={finderOpen} onOpenChange={setFinderOpen} />
    </div>
  )
}
