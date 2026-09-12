import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useVapiCall } from './useVapiCall'

/**
 * Places one call and shows what is said as it is said.
 * The transcript here is the live view. The stored record arrives separately
 * through the end-of-call-report webhook.
 */

interface CallPanelProps {
  patientName: string
  /** Gap questions. Passed to the assistant as {{goals}}. */
  goals: string[]
}

const STATUS_COPY = {
  idle: 'Not started.',
  connecting: 'Connecting.',
  'in-progress': 'Call in progress.',
  ended: 'Call ended.',
  failed: 'Call failed.',
} as const

export function CallPanel({ patientName, goals }: CallPanelProps) {
  const { status, transcript, language, problem, start, stop } = useVapiCall()
  const live = status === 'connecting' || status === 'in-progress'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {live ? (
          <Button variant="destructive" onClick={stop}>
            End call
          </Button>
        ) : (
          <Button onClick={() => start({ goals, patientName })}>Call {patientName}</Button>
        )}
        <span className="text-sm text-muted-foreground">{STATUS_COPY[status]}</span>
        {language ? (
          <span className="text-sm text-muted-foreground">Speaking {language}.</span>
        ) : null}
      </div>

      {problem ? (
        <Alert variant="destructive">
          <AlertTitle>The call could not run.</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {transcript.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has been said yet. The transcript appears here as the call runs.
          </p>
        ) : (
          transcript.map((line, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {line.role === 'assistant' ? 'Assistant' : patientName}
              </span>
              <p className="text-sm">{line.text}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
