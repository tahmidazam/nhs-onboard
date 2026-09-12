import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useVapiCall } from './useVapiCall'

/**
 * Places one call and renders each turn as it completes.
 * This transcript is the live view and is not stored. The saved copy arrives
 * later through the end-of-call-report webhook.
 */

interface CallPanelProps {
  patientName: string
  patientAge: number
  patientDob: string
  /** Gap questions. Passed to the assistant as {{goals}}. */
  goals: string[]
  /**
   * Runs once Vapi returns the call id. Wire this to `api.call.register` so the
   * end-of-call report has a row to write into. Without it the call still runs
   * and the transcript is discarded.
   */
  onCallStarted?: (vapiCallId: string) => void | Promise<void>
}

const STATUS_COPY = {
  idle: 'Not started.',
  connecting: 'Connecting.',
  'in-progress': 'Call in progress.',
  ended: 'Call ended.',
  failed: 'Call failed.',
} as const

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' })

/** Deepgram reports BCP-47, which a clinician should never have to read. */
function languageName(tag: string): string {
  try {
    return LANGUAGE_NAMES.of(tag) ?? tag
  } catch {
    return tag
  }
}

export function CallPanel({
  patientName,
  patientAge,
  patientDob,
  goals,
  onCallStarted,
}: CallPanelProps) {
  const { status, transcript, language, problem, start, stop } = useVapiCall({
    onStarted: onCallStarted,
  })
  const live = status === 'connecting' || status === 'in-progress'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {live ? (
          <Button variant="destructive" onClick={stop}>
            End call
          </Button>
        ) : (
          <Button onClick={() => start({ goals, patientName, patientAge, patientDob })}>Call {patientName}</Button>
        )}
        <span className="text-sm text-muted-foreground">{STATUS_COPY[status]}</span>
        {language ? (
          <span className="text-sm text-muted-foreground">
            {patientName} is speaking {languageName(language)}.
          </span>
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
            No one has spoken yet. Each line appears here when a turn finishes.
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
