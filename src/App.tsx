import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CallPanel } from '@/components/call/CallPanel'

/**
 * Placeholder shell for the voice path. The board route replaces it.
 * Questions come from the patient's open gaps, so the call asks what the
 * records could not answer.
 */
export default function App() {
  const patient = useQuery(api.dev.demoPatient)
  const seed = useMutation(api.dev.seedDemoPatient)
  const questions = useQuery(
    api.call.openQuestions,
    patient ? { patientId: patient._id } : 'skip',
  )
  const register = useMutation(api.call.register)

  if (patient === undefined) return null

  if (patient === null) {
    return (
      <div className="flex flex-col gap-4 p-8 max-w-2xl">
        <h1 className="text-lg">NHS Onboard</h1>
        <Alert>
          <AlertTitle>No patient to call yet.</AlertTitle>
          <AlertDescription>
            The sim adapter and the rule pack are not wired up, so seed one patient and the
            gaps a call would close.
          </AlertDescription>
        </Alert>
        <div>
          <Button onClick={() => void seed({})}>Create the demo patient</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-8 max-w-2xl">
      <h1 className="text-lg">NHS Onboard</h1>
      <CallPanel
        patientName={patient.name}
        goals={questions ?? []}
        onCallStarted={async (vapiCallId) => {
          await register({ patientId: patient._id, vapiCallId })
        }}
      />
    </div>
  )
}
