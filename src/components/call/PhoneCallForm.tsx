import { useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Rings a real phone through the Twilio number on the Vapi account.
 * The transcript arrives on the end-of-call-report webhook, not here.
 */

interface PhoneCallFormProps {
  patientId: Id<'patients'>
  questionCount: number
}

export function PhoneCallForm({ patientId, questionCount }: PhoneCallFormProps) {
  const place = useAction(api.call.place)
  const [number, setNumber] = useState('')
  const [status, setStatus] = useState<'idle' | 'placing' | 'ringing'>('idle')
  const [problem, setProblem] = useState<string | null>(null)

  /** Vapi rejects anything that is not E.164. */
  const valid = /^\+[1-9]\d{7,14}$/.test(number.trim())

  async function ring() {
    setProblem(null)
    setStatus('placing')
    try {
      await place({ patientId, number: number.trim() })
      setStatus('ringing')
    } catch (e) {
      setStatus('idle')
      setProblem(e instanceof Error ? e.message : 'The call could not be placed.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="+447700900000"
          aria-label="Phone number in international format"
          className="max-w-56"
        />
        <Button onClick={() => void ring()} disabled={!valid || status === 'placing'}>
          {status === 'placing' ? 'Placing the call' : 'Call this number'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {status === 'ringing'
          ? `The phone should ring. The assistant has ${questionCount} questions to ask.`
          : 'International format, starting with a plus and the country code.'}
      </p>

      {problem ? (
        <Alert variant="destructive">
          <AlertTitle>The call could not be placed.</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
