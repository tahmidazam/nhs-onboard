import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { OnboardedTable } from './OnboardedTable'
import { PatientFinderDialog } from './PatientFinderDialog'

export function Board() {
  const [finderOpen, setFinderOpen] = useState(false)
  const patients = useQuery(api.patients.list)
  const seed = useMutation(api.dev.seedDemoPatient)
  const [seeding, setSeeding] = useState(false)

  /**
   * Nothing writes gaps for a patient onboarded from the simulator yet, so an
   * empty board has nothing the voice path can ask about. Drop this button
   * once convex/rules.ts runs as part of onboarding.
   */
  const empty = patients?.length === 0

  async function seedDemo() {
    setSeeding(true)
    try {
      const { gaps } = await seed({})
      toast.add({
        type: 'success',
        title: 'Demo patient created',
        description: `Rahim Uddin has ${gaps} open questions for the call.`,
      })
    } catch (e) {
      toast.add({
        type: 'error',
        title: 'The demo patient could not be created',
        description: e instanceof Error ? e.message : undefined,
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
          {empty ? (
            <Button variant="outline" onClick={() => void seedDemo()} disabled={seeding}>
              {seeding ? <Spinner /> : null}
              Create the demo patient
            </Button>
          ) : null}
          <Button onClick={() => setFinderOpen(true)}>
            <PlusIcon />
            Find a patient
          </Button>
        </div>
      </div>

      <OnboardedTable />

      <PatientFinderDialog open={finderOpen} onOpenChange={setFinderOpen} />
    </div>
  )
}
