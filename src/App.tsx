import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CallPanel } from '@/components/call/CallPanel'
import { PhoneCallForm } from '@/components/call/PhoneCallForm'
import { StoredTranscript } from '@/components/call/StoredTranscript'

/**
 * Placeholder shell for the voice path. The board route replaces it.
 * Questions come from the patient's open gaps, so the call asks what the
 * records could not answer.
 */
export default function App() {
  const patient = useQuery(api.dev.demoPatient)
  const seed = useMutation(api.dev.seedDemoPatient)
  const context = useQuery(api.call.callContext, patient ? { patientId: patient._id } : 'skip')
  const register = useMutation(api.call.register)

  return (
    <div className="flex flex-col gap-6 p-8 max-w-2xl">
      <h1 className="text-lg">NHS Onboard</h1>

      {patient === undefined ? (
        <p className="text-sm text-muted-foreground">
          Reading the patient list. If this does not clear, the browser cannot reach Convex:
          check VITE_CONVEX_URL and that convex dev is running.
        </p>
      ) : patient === null ? (
        <>
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
        </>
      ) : (
        <>
          <PhoneCallForm patientId={patient._id} questionCount={context?.goals.length ?? 0} />
          <CallPanel
            patientName={context?.patientName ?? patient.name}
            patientAge={context?.patientAge ?? 0}
            patientDob={context?.patientDob ?? ''}
            goals={context?.goals ?? []}
            onCallStarted={async (vapiCallId) => {
              await register({ patientId: patient._id, vapiCallId })
            }}
          />
          <StoredTranscript patientId={patient._id} />
        </>
      )}
    </div>
  )
}
