import { useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Rings the phone on DEMO_PHONE_NUMBER through the Twilio number on the Vapi
 * account. The transcript arrives on the end-of-call-report webhook, not here.
 */

interface PhoneCallFormProps {
  patientId: Id<'patients'>
  questionCount: number
}

export function PhoneCallForm({ patientId, questionCount }: PhoneCallFormProps) {
  const place = useAction(api.call.place)
  const [status, setStatus] = useState<'idle' | 'placing' | 'ringing'>('idle')
  const [problem, setProblem] = useState<string | null>(null)

  async function ring() {
    setProblem(null)
    setStatus('placing')
    try {
      await place({ patientId })
      setStatus('ringing')
    } catch (e) {
      setStatus('idle')
      setProblem(e instanceof Error ? e.message : 'The call could not be placed.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button onClick={() => void ring()} disabled={status === 'placing'}>
          {status === 'placing' ? 'Placing the call' : 'Call the patient'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {status === 'ringing'
            ? `The phone should ring. The assistant has ${questionCount} questions to ask.`
            : `Rings the number on DEMO_PHONE_NUMBER. ${questionCount} questions to ask.`}
        </span>
      </div>

      {problem ? (
        <Alert variant="destructive">
          <AlertTitle>The call could not be placed.</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
